import { isRuntimeId, type RuntimeId } from '@/lib/runtime/runtime-id';

export const MODEL_ROUTE_FAVORITES_KEY = 'codepilot:model-route-favorites:v2';

export interface ModelRouteFavoriteV2 {
  runtimeId: RuntimeId;
  providerInstanceId: string;
  modelId: string;
  providerNameSnapshot: string;
  modelNameSnapshot: string;
  createdAt: number;
}

interface ModelRouteFavoriteEnvelopeV2 {
  version: 2;
  favorites: ModelRouteFavoriteV2[];
}

interface ModelRouteFavoriteFields {
  providerInstanceId: string;
  modelId: string;
  providerNameSnapshot: string;
  modelNameSnapshot: string;
  createdAt: number;
}

export function modelRouteIdentity(providerInstanceId: string, modelId: string): string {
  return `${providerInstanceId}\u0000${modelId}`;
}

export function modelRouteFavoriteIdentity(
  runtimeId: RuntimeId,
  providerInstanceId: string,
  modelId: string,
): string {
  return `${runtimeId}\u0000${modelRouteIdentity(providerInstanceId, modelId)}`;
}

function hasFavoriteFields(value: unknown): value is ModelRouteFavoriteFields {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<ModelRouteFavoriteFields>;
  return typeof row.providerInstanceId === 'string'
    && typeof row.modelId === 'string'
    && typeof row.providerNameSnapshot === 'string'
    && typeof row.modelNameSnapshot === 'string'
    && typeof row.createdAt === 'number'
    && Number.isFinite(row.createdAt);
}

function isFavorite(value: unknown): value is ModelRouteFavoriteV2 {
  return hasFavoriteFields(value)
    && isRuntimeId((value as Partial<ModelRouteFavoriteV2>).runtimeId);
}

export function parseModelRouteFavorites(
  raw: string | null | undefined,
): ModelRouteFavoriteV2[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<ModelRouteFavoriteEnvelopeV2> & {
      version?: number;
      favorites?: unknown[];
    };
    if (!Array.isArray(parsed.favorites)) return [];
    const candidates: ModelRouteFavoriteV2[] = parsed.version === 2
      ? parsed.favorites.filter(isFavorite)
      : [];
    const seen = new Set<string>();
    return candidates.filter((favorite) => {
      const id = modelRouteFavoriteIdentity(
        favorite.runtimeId,
        favorite.providerInstanceId,
        favorite.modelId,
      );
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } catch {
    return [];
  }
}

export function serializeModelRouteFavorites(favorites: readonly ModelRouteFavoriteV2[]): string {
  return JSON.stringify({ version: 2, favorites });
}

export function toggleModelRouteFavorite(
  favorites: readonly ModelRouteFavoriteV2[],
  favorite: ModelRouteFavoriteV2,
): ModelRouteFavoriteV2[] {
  const target = modelRouteFavoriteIdentity(
    favorite.runtimeId,
    favorite.providerInstanceId,
    favorite.modelId,
  );
  const exists = favorites.some((item) =>
    modelRouteFavoriteIdentity(item.runtimeId, item.providerInstanceId, item.modelId) === target,
  );
  if (exists) {
    return favorites.filter((item) =>
      modelRouteFavoriteIdentity(item.runtimeId, item.providerInstanceId, item.modelId) !== target,
    );
  }
  return [favorite, ...favorites];
}

export interface SearchableModelRoute {
  providerInstanceId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  catalogOrder: number;
  favorite: boolean;
  recentAt?: number;
}

function textScore(query: string, value: string): number {
  const candidate = value.toLocaleLowerCase();
  if (candidate === query) return 400;
  if (candidate.startsWith(query)) return 300;
  if (candidate.includes(query)) return 200;
  const words = query.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => candidate.includes(word)) ? 100 : -1;
}

/** Exact/prefix/substring quality stays ahead of favorite and recency boosts. */
export function rankModelRoutes<T extends SearchableModelRoute>(
  routes: readonly T[],
  rawQuery: string,
): T[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  return routes
    .map((route) => {
      const haystacks = [route.modelName, route.modelId, route.providerName];
      const score = query
        ? Math.max(...haystacks.map((value) => textScore(query, value)))
        : 0;
      return { route, score };
    })
    .filter(({ score }) => !query || score >= 0)
    .sort((a, b) =>
      b.score - a.score
      || Number(b.route.favorite) - Number(a.route.favorite)
      || (b.route.recentAt ?? 0) - (a.route.recentAt ?? 0)
      || a.route.catalogOrder - b.route.catalogOrder,
    )
    .map(({ route }) => route);
}
