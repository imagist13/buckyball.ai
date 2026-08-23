"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { SpinnerGap, CaretDown, CaretUp, ArrowSquareOut, CheckCircle, XCircle, Warning } from "@/components/ui/icon";
import { BuckyballIcon } from "@/components/ui/semantic-icon";
import type { ProviderFormData } from "./ProviderForm";
import type { QuickPreset } from "./provider-presets";
import { QUICK_PRESETS } from "./provider-presets";
import type { ApiProvider } from "@/types";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

/** Infer auth style from base URL by fuzzy-matching preset hostnames */
function inferAuthStyleFromUrl(url: string): "api_key" | "auth_token" | null {
  if (!url) return null;
  const urlLower = url.toLowerCase();
  for (const p of QUICK_PRESETS) {
    if (!p.base_url) continue;
    try {
      const presetHost = new URL(p.base_url).hostname;
      if (urlLower.includes(presetHost)) {
        return p.authStyle as "api_key" | "auth_token";
      }
    } catch { /* skip invalid URLs */ }
  }
  return null;
}

interface PresetConnectDialogProps {
  preset: QuickPreset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: ProviderFormData) => Promise<void>;
  /** When set, dialog operates in edit mode (pre-fills from existing provider) */
  editProvider?: ApiProvider | null;
}

export function PresetConnectDialog({
  preset,
  open,
  onOpenChange,
  onSave,
  editProvider,
}: PresetConnectDialogProps) {
  const isEdit = !!editProvider;
  const [apiKey, setApiKey] = useState("");
  // Edit-mode flag: DB already has a stored key for this provider. When true
  // and apiKey is empty, the UI shows a "keep existing" placeholder and
  // test/save requests OMIT the apiKey field so the backend falls back to the
  // stored value. This is the fix for #449 â?the old code shoved the masked
  // key string into state and sent it back, which tried to auth with "***"
  // against upstream APIs. See docs/exec-plans/active/v0.48-post-release-issues.md Â§5.5.
  const [hasStoredKey, setHasStoredKey] = useState(false);
  // Companion flag for an explicit "I want to clear the stored key" intent.
  // Without this, users would have no way to delete a stored key â?the
  // hasStoredKey + empty input combination is unconditionally interpreted as
  // "keep existing". When clearStoredKey=true, save sends api_key="" so the
  // backend overwrites the stored value.
  const [clearStoredKey, setClearStoredKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [name, setName] = useState("");
  const [extraEnv, setExtraEnv] = useState("{}");
  const [modelName, setModelName] = useState("");
  // Auth style for anthropic-thirdparty: 'api_key' or 'auth_token'
  const [authStyle, setAuthStyle] = useState<"api_key" | "auth_token">("api_key");
  // Track the initial auth style to detect changes
  const [initialAuthStyle, setInitialAuthStyle] = useState<"api_key" | "auth_token">("api_key");
  // Edit-mode advanced fields
  const [headersJson, setHeadersJson] = useState("{}");
  const [envOverridesJson, setEnvOverridesJson] = useState("");
  const [notes, setNotes] = useState("");
  // Model mapping fields (sonnet/opus/haiku â?actual API model IDs)
  const [mapSonnet, setMapSonnet] = useState("");
  const [mapOpus, setMapOpus] = useState("");
  const [mapHaiku, setMapHaiku] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: { code: string; message: string; suggestion: string; recoveryActions?: Array<{ label: string; url?: string; action?: string }> } } | null>(null);
  const { t } = useTranslation();
  const isZh = t('nav.chats') === 'å¯¹è¯';

  // Unified auth-style transition. Both the dropdown selector and the
  // "smart recommend" helper link MUST go through this helper so edit-mode
  // stored-key state migrates consistently. Switching AWAY from the stored
  // style clears hasStoredKey (the user must provide a key for the new
  // scheme); switching BACK restores it. Any pending "clear" intent is
  // cancelled because an auth-style change is an unrelated user action.
  const applyAuthStyleChange = (newStyle: "api_key" | "auth_token") => {
    setAuthStyle(newStyle);
    if (isEdit && editProvider?.api_key) {
      setApiKey("");
      setClearStoredKey(false);
      setHasStoredKey(newStyle === initialAuthStyle);
    }
  };

  // Whether the "Test connection" button can meaningfully run with the
  // current form state. Four cases:
  //   1. Preset doesn't use api_key (Bedrock / Vertex / extra_env) â?always OK.
  //   2. User typed a replacement key â?test with it directly.
  //   3. Edit mode with an untouched stored key â?backend back-fills via providerId.
  //   4. Edit mode with a pending clear and no replacement â?test would
  //      use the DB key that's about to be deleted, giving a misleading
  //      success. Block it â?the user must either enter a new key or
  //      undo the clear first. This is the Codex P2 clear-and-test
  //      defense; without it, clicking Test in the pending-clear state
  //      reports success with credentials the saved config won't have.
  const canTest = (() => {
    if (!preset?.fields.includes("api_key")) return true;
    if (apiKey) return true;
    if (isEdit && hasStoredKey && !clearStoredKey) return true;
    return false;
  })();

  const handleTestConnection = async () => {
    // Belt-and-suspenders: the button disabled state already enforces
    // this, but guard here in case something bypasses the UI (keyboard
    // event, third-party DOM manipulation).
    if (!canTest) return;

    setTesting(true);
    setTestResult(null);
    try {
      const envOverrides: Record<string, string> = {};
      try {
        const parsed = JSON.parse(extraEnv || '{}');
        Object.assign(envOverrides, parsed);
      } catch { /* ignore */ }
      // #449 fix: in edit mode, send providerId so the backend can look up the
      // real key from DB when the user hasn't touched the placeholder. Omit
      // apiKey entirely in that case â?never send the masked value.
      const body: Record<string, unknown> = {
        presetKey: preset?.key,
        baseUrl: baseUrl || preset?.base_url || '',
        protocol: preset?.protocol || 'anthropic',
        authStyle: preset?.key === 'anthropic-thirdparty' ? authStyle : (preset?.authStyle || authStyle),
        envOverrides,
        modelName: modelName || undefined,
        providerName: name || preset?.name,
      };
      if (isEdit && editProvider) {
        body.providerId = editProvider.id;
      }
      if (apiKey) {
        body.apiKey = apiKey;
      }
      // If edit mode + empty apiKey + hasStoredKey â?body has providerId but
      // no apiKey field, backend will back-fill from DB.
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: t('provider.form.errorTestEndpoint' as TranslationKey),
          suggestion: t('provider.form.errorTestEndpointHint' as TranslationKey),
        },
      });
    } finally {
      setTesting(false);
    }
  };

  // Reset form when dialog opens
  useEffect(() => {
    if (!open || !preset) return;
    setError(null);
    setSaving(false);
    setTesting(false);
    setTestResult(null);
    setClearStoredKey(false);

    if (isEdit && editProvider) {
      // Edit mode â?pre-fill from existing provider
      setName(editProvider.name);
      setBaseUrl(editProvider.base_url);
      setExtraEnv(editProvider.extra_env || preset.extra_env);
      // Use preset authStyle as source of truth; fall back to extra_env inference for legacy records
      let detected: 'auth_token' | 'api_key' = preset.authStyle === 'auth_token' ? 'auth_token' : 'api_key';
      if (preset.key === 'anthropic-thirdparty') {
        // Thirdparty presets: infer from stored extra_env since user chose the style
        try {
          const env = JSON.parse(editProvider.extra_env || "{}");
          detected = "ANTHROPIC_AUTH_TOKEN" in env ? "auth_token" : "api_key";
        } catch { /* keep preset default */ }
      }
      setAuthStyle(detected);
      setInitialAuthStyle(detected);
      // #449 fix: DO NOT put the (possibly masked) stored key into apiKey state.
      // Instead, set hasStoredKey=true and keep apiKey empty. The input will
      // show a "keep existing" placeholder; test/save will omit the apiKey
      // field and backend back-fills from DB.
      if (!preset.fields.includes("api_key") && !editProvider.api_key) {
        // Preset doesn't expose api_key field AND stored is empty â?pre-fill
        // from preset extra_env default (e.g. Ollama uses 'ollama' token).
        const presetEnv = (() => { try { return JSON.parse(preset.extra_env || '{}'); } catch { return {}; } })();
        const defaultToken = detected === 'auth_token'
          ? (presetEnv['ANTHROPIC_AUTH_TOKEN'] || '')
          : (presetEnv['ANTHROPIC_API_KEY'] || '');
        setApiKey(defaultToken);
        setHasStoredKey(false);
      } else {
        setApiKey("");
        setHasStoredKey(!!editProvider.api_key);
      }
      // Pre-fill advanced fields
      setHeadersJson(editProvider.headers_json || "{}");
      setEnvOverridesJson(editProvider.env_overrides_json || "");
      setNotes(editProvider.notes || "");
      // Pre-fill model name from role_models_json
      try {
        const rm = JSON.parse(editProvider.role_models_json || "{}");
        setModelName(rm.default || "");
        setMapSonnet(rm.sonnet || "");
        setMapOpus(rm.opus || "");
        setMapHaiku(rm.haiku || "");
      } catch {
        setModelName("");
        setMapSonnet("");
        setMapOpus("");
        setMapHaiku("");
      }
      // Auto-expand advanced if there's meaningful data beyond preset defaults
      const hasModelMapping = (() => {
        try {
          const rm = JSON.parse(editProvider.role_models_json || "{}");
          return !!(rm.sonnet || rm.opus || rm.haiku);
        } catch { return false; }
      })();
      const hasExtraEnvBeyondAuth = (() => {
        try {
          const env = JSON.parse(editProvider.extra_env || "{}");
          const meaningful = Object.keys(env).filter(k =>
            k !== "ANTHROPIC_API_KEY" && k !== "ANTHROPIC_AUTH_TOKEN"
          );
          return meaningful.length > 0;
        } catch { return false; }
      })();
      const hasHeaders = editProvider.headers_json && editProvider.headers_json !== "{}";
      const hasEnvOverrides = !!editProvider.env_overrides_json;
      const hasNotes = !!editProvider.notes;
      setShowAdvanced(hasModelMapping || hasExtraEnvBeyondAuth || !!hasHeaders || hasEnvOverrides || hasNotes);
    } else {
      // Create mode â?reset to preset defaults
      setBaseUrl(preset.base_url);
      setName(preset.name);
      setExtraEnv(preset.extra_env);
      // Pre-fill the model-name field with the preset's default model id so a
      // preset that requires a user-specified model (e.g. MiMo) shows its
      // current model (editable) rather than an empty box (#577). Harmless for
      // presets without the model_names field â?the value is only read on save
      // when that field is exposed.
      setModelName(preset.defaultModelId || "");
      // Use authStyle directly from preset (single source of truth)
      const detectedStyle = (preset.authStyle === 'auth_token' ? 'auth_token' : 'api_key') as 'api_key' | 'auth_token';
      // If preset doesn't expose api_key field, pre-fill from extra_env default
      // (e.g. Ollama needs ANTHROPIC_AUTH_TOKEN='ollama' without user input)
      if (!preset.fields.includes("api_key")) {
        const presetEnv = (() => { try { return JSON.parse(preset.extra_env || '{}'); } catch { return {}; } })();
        const defaultToken = detectedStyle === 'auth_token'
          ? (presetEnv['ANTHROPIC_AUTH_TOKEN'] || '')
          : (presetEnv['ANTHROPIC_API_KEY'] || '');
        setApiKey(defaultToken);
      } else {
        setApiKey("");
      }
      setHasStoredKey(false);
      setAuthStyle(detectedStyle);
      setInitialAuthStyle(detectedStyle);
      setMapSonnet("");
      setMapOpus("");
      setMapHaiku("");
      setHeadersJson("{}");
      setEnvOverridesJson("");
      setNotes("");
      setShowAdvanced(false);
    }
  }, [open, preset, isEdit, editProvider]);

  if (!preset) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Anthropic-protocol presets (any preset that isn't pinned to a vendor
    // URL) must require an explicit base URL. Empty URL on an anthropic
    // provider is indistinguishable at resolver time from a legacy Default
    // migration and would silently proxy to api.anthropic.com with the
    // first-party catalog (xhigh / Opus 4.7 upstream / 1M window). Mirrored
    // by server-side validation in /api/providers route; this pre-check is
    // just for a clearer UX.
    if (preset.protocol === 'anthropic' && !preset.base_url && !baseUrl.trim()) {
      setError(isZh
        ? 'è¯·å¡«å?Base URLï¼å®æ?API ä½¿ç¨ https://api.anthropic.comï¼?
        : 'Please specify a base URL (use https://api.anthropic.com for the official API)');
      return;
    }
    // Third-party media presets: empty baseUrl would silently resolve to the
    // official endpoint server-side. Mirror the anthropic-thirdparty rule so
    // the user gets a clear error before saving.
    if (
      (preset.protocol === 'openai-image' || preset.protocol === 'gemini-image')
      && !preset.base_url
      && !baseUrl.trim()
    ) {
      setError(isZh
        ? 'è¯·å¡«å?Base URLï¼çç©ºä¼åè½å°å®æ¹æå¡ï¼æ æ³ä½ä¸ºç¬¬ä¸æ¹çæï¼'
        : 'Please specify a base URL (leaving this blank falls back to the official endpoint)');
      return;
    }

    // If auth style changed in edit mode, require a new key.
    // hasStoredKey is cleared when the user switches away from the stored
    // style (see auth style onValueChange), so checking !apiKey alone is
    // sufficient â?masked values no longer enter state.
    if (isEdit && authStyle !== initialAuthStyle && !apiKey) {
      setError(isZh
        ? 'åæ¢è®¤è¯æ¹å¼åéè¦éæ°è¾å¥å¯é?
        : 'Please re-enter the key after changing auth style');
      return;
    }

    // For anthropic-thirdparty, inject the correct auth key into extra_env
    // while preserving any other user-specified env vars (e.g. API_TIMEOUT_MS)
    let finalExtraEnv = extraEnv;
    if (preset.key === "anthropic-thirdparty") {
      try {
        const parsed = JSON.parse(extraEnv || "{}");
        // Remove both auth keys, then set the correct one
        delete parsed["ANTHROPIC_API_KEY"];
        delete parsed["ANTHROPIC_AUTH_TOKEN"];
        if (authStyle === "auth_token") {
          parsed["ANTHROPIC_AUTH_TOKEN"] = "";
        } else {
          parsed["ANTHROPIC_API_KEY"] = "";
        }
        finalExtraEnv = JSON.stringify(parsed);
      } catch {
        // If parse fails, fall back to simple replacement
        finalExtraEnv = authStyle === "auth_token"
          ? '{"ANTHROPIC_AUTH_TOKEN":""}'
          : '{"ANTHROPIC_API_KEY":""}';
      }
    }
    // In edit mode, preserve existing role_models_json unless the user modifies mapping fields
    let roleModelsJson = (isEdit && editProvider?.role_models_json) ? editProvider.role_models_json : "{}";

    // Model mapping (sonnet/opus/haiku â?actual API model IDs)
    // Merge into existing roleModels to preserve roles not shown in this preset.
    // If the preset exposes these fields and user cleared them all, remove those keys.
    if (preset.fields.includes("model_mapping")) {
      const hasAny = mapSonnet.trim() || mapOpus.trim() || mapHaiku.trim();
      if (hasAny) {
        // If user fills any, all 3 are required
        if (!mapSonnet.trim() || !mapOpus.trim() || !mapHaiku.trim()) {
          setError(isZh
            ? 'æ¨¡åæ å°éè¦åæ¶å¡«å?SonnetãOpusãHaiku ä¸ä¸ªæ¨¡ååç§°'
            : 'Model mapping requires all 3 model names (Sonnet, Opus, Haiku)');
          return;
        }
        const existing = (() => { try { return JSON.parse(roleModelsJson); } catch { return {}; } })();
        roleModelsJson = JSON.stringify({
          ...existing,
          sonnet: mapSonnet.trim(),
          opus: mapOpus.trim(),
          haiku: mapHaiku.trim(),
        });
      } else {
        // All cleared â?remove these keys from existing
        const existing = (() => { try { return JSON.parse(roleModelsJson); } catch { return {}; } })();
        delete existing.sonnet;
        delete existing.opus;
        delete existing.haiku;
        roleModelsJson = JSON.stringify(existing);
      }
    }

    // Inject model name into role_models_json â?merge, don't replace.
    // If the preset exposes model_names and user cleared it, remove the default key.
    if (preset.fields.includes("model_names")) {
      const existing = (() => { try { return JSON.parse(roleModelsJson); } catch { return {}; } })();
      if (modelName.trim()) {
        roleModelsJson = JSON.stringify({ ...existing, default: modelName.trim() });
      } else {
        delete existing.default;
        roleModelsJson = JSON.stringify(existing);
      }
    }

    // Validate JSON fields. Reuses the same i18n keys as ProviderForm so
    // both surfaces ("manual" vs "preset" path) emit consistent error
    // copy in zh/en. Field labels go through `t(...)` so the error reads
    // as "<the field you just looked at> must be valid JSON".
    // Headers and Env Overrides are only saved on the edit path
    // (`env_overrides_json: isEdit ? â?: undefined`), so we only validate
    // them when isEdit. envOverridesJson was historically missing from
    // this list â?invalid JSON would silently slip past the front end and
    // surface as a runtime parse failure later.
    const jsonFields: Array<[TranslationKey, string]> = [
      ['provider.extraEnvVars' as TranslationKey, finalExtraEnv],
    ];
    if (isEdit) {
      jsonFields.push(['provider.form.headersJson' as TranslationKey, headersJson]);
      jsonFields.push(['provider.form.envOverridesJson' as TranslationKey, envOverridesJson]);
    }
    for (const [labelKey, val] of jsonFields) {
      if (val && val.trim()) {
        try { JSON.parse(val); } catch {
          setError(t('provider.form.errorJsonInvalid' as TranslationKey, { field: t(labelKey) }));
          return;
        }
      }
    }

    setSaving(true);
    try {
      // #449 fix: three distinct save intents for api_key in edit mode.
      //
      //   apiKey non-empty         â?"new value" â?always wins.
      //   hasStoredKey, clearStoredKey=true â?"clear it" â?send "" so the
      //       backend overwrites the stored value. updateProvider()'s
      //       `?? existing.api_key` only falls back on nullish, so "" wins.
      //   hasStoredKey, clearStoredKey=false â?"keep existing" â?omit the
      //       field entirely. undefined â?JSON.stringify drops the key â?      //       PUT body has no api_key â?updateProvider() preserves DB value.
      //   create mode / no stored key â?pass apiKey as-is (possibly "").
      const apiKeyForSave: string | undefined = (() => {
        if (apiKey) return apiKey;
        if (isEdit && hasStoredKey && clearStoredKey) return "";
        if (isEdit && hasStoredKey) return undefined;
        return apiKey;
      })();
      await onSave({
        name: name.trim() || preset.name,
        preset_key: preset.key,
        provider_type: preset.provider_type,
        protocol: preset.protocol,
        base_url: baseUrl.trim(),
        api_key: apiKeyForSave,
        extra_env: finalExtraEnv,
        role_models_json: roleModelsJson,
        headers_json: isEdit ? headersJson.trim() || "{}" : undefined,
        env_overrides_json: isEdit ? envOverridesJson.trim() || "" : undefined,
        notes: isEdit ? notes.trim() : "",
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : (isEdit
        ? t('provider.form.errorUpdateFailed' as TranslationKey)
        : t('provider.form.errorAddFailed' as TranslationKey)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fullscreen>
        <div className="min-h-full flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
        <DialogHeader className="mb-6">
          <DialogTitle className="flex items-center gap-2.5 text-xl">
            {preset.icon}
            {isEdit ? t('provider.editProvider') : t('provider.connect')} {preset.name}
          </DialogTitle>
          <DialogDescription>
            {isZh ? preset.descriptionZh : preset.description}
          </DialogDescription>
        </DialogHeader>

        {/* Meta info panel â?API key link, billing badge, notes */}
        {preset.meta && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {preset.meta.billingModel && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                  {preset.meta.billingModel === 'pay_as_you_go' ? (isZh ? 'æéä»è´¹' : 'Pay-as-you-go')
                    : preset.meta.billingModel === 'coding_plan' ? 'Coding Plan'
                    : preset.meta.billingModel === 'token_plan' ? 'Token Plan'
                    : preset.meta.billingModel === 'free' ? (isZh ? 'åè´¹' : 'Free')
                    : preset.meta.billingModel === 'self_hosted' ? (isZh ? 'èªæç®? : 'Self-hosted')
                    : preset.meta.billingModel}
                </span>
              )}
              {preset.meta.apiKeyUrl && (
                <a href={preset.meta.apiKeyUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                  <ArrowSquareOut size={12} />
                  {isZh ? 'è·å API Key' : 'Get API Key'}
                </a>
              )}
              {preset.meta.docsUrl && (
                <a href={preset.meta.docsUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                  <ArrowSquareOut size={12} />
                  {isZh ? 'å®æ¹ææ¡£' : 'Official docs'}
                </a>
              )}
              {preset.meta.purchaseUrl && (
                <a href={preset.meta.purchaseUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                  <ArrowSquareOut size={12} />
                  {isZh ? 'è´­ä¹°æç®¡çå¥é¤? : 'Purchase or manage plan'}
                </a>
              )}
              <a href={isZh ? 'https://www.codepilot.sh/zh/docs/providers' : 'https://www.codepilot.sh/docs/providers'} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                <ArrowSquareOut size={12} />
                {isZh ? 'éç½®æå' : 'Setup Guide'}
              </a>
            </div>
            {(isZh ? (preset.meta.notesZh ?? preset.meta.notes) : preset.meta.notes)?.length ? (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 space-y-1">
                {(isZh ? (preset.meta.notesZh ?? preset.meta.notes) : preset.meta.notes)!.map((note, i) => (
                  <p key={i} className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                    <Warning size={12} className="shrink-0 mt-0.5" />
                    {note}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 min-w-0 mt-6">
          {/* Name field â?custom/thirdparty */}
          {preset.fields.includes("name") && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('provider.name')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={preset.name}
                className="text-sm"
              />
            </div>
          )}

          {/* Base URL */}
          {preset.fields.includes("base_url") && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('provider.baseUrl')}</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                className="text-sm font-mono"
              />
            </div>
          )}

          {/* API Key with optional auth style select */}
          {preset.fields.includes("api_key") && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                {preset.key === "anthropic-thirdparty"
                  ? (authStyle === "auth_token" ? "Auth Token" : "API Key")
                  : "API Key"}
              </Label>
              <div className="flex gap-2">
                {preset.key === "anthropic-thirdparty" && (
                  <Select
                    value={authStyle}
                    onValueChange={(v) => applyAuthStyleChange(v as "api_key" | "auth_token")}
                  >
                    <SelectTrigger className="w-[130px] shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="api_key">API Key</SelectItem>
                      <SelectItem value="auth_token">Auth Token</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    // Typing a new key overrides any pending "clear" intent
                    if (clearStoredKey) setClearStoredKey(false);
                  }}
                  placeholder={
                    clearStoredKey
                      ? (isZh ? "ä¿å­åå°æ¸ç©ºå·²å­å¯é¥" : "Stored key will be cleared on save")
                      : hasStoredKey
                      ? (isZh ? "å·²ä¿å­ï¼çç©ºåæ²¿ç¨åå¯é¥" : "Saved â?leave blank to keep existing")
                      : (authStyle === "auth_token" ? "token-..." : "sk-...")
                  }
                  className="text-sm font-mono flex-1"
                  autoFocus
                />
              </div>
              {/* Explicit "clear stored key" action â?only visible in edit
                  mode when a stored key exists and the user hasn't typed a
                  replacement. Without this, hasStoredKey + empty input was
                  always interpreted as "keep existing", leaving users with
                  no way to actually delete a stored key. */}
              {isEdit && hasStoredKey && !apiKey && (
                <p className="text-[11px]">
                  {clearStoredKey ? (
                    <>
                      <span className="text-amber-500">
                        {isZh ? "ä¿å­åå°æ¸ç©ºå·²å­å¯é¥ã? : "The stored key will be cleared on save. "}
                      </span>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0 text-[11px] text-amber-500 underline hover:no-underline"
                        onClick={() => setClearStoredKey(false)}
                      >
                        {isZh ? "æ¤é" : "Undo"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-[11px] text-muted-foreground underline hover:no-underline"
                      onClick={() => setClearStoredKey(true)}
                    >
                      {isZh ? "æ¸é¤å·²å­å¯é¥" : "Clear stored key"}
                    </Button>
                  )}
                </p>
              )}
              {/* Smart recommend for thirdparty based on URL */}
              {preset.key === "anthropic-thirdparty" && baseUrl && (() => {
                const inferred = inferAuthStyleFromUrl(baseUrl);
                return inferred && inferred !== authStyle ? (
                  <p className="text-[11px] text-amber-500">
                    {isZh
                      ? `æ£æµå°æ­?URL éå¸¸ä½¿ç¨ ${inferred === 'auth_token' ? 'Auth Token' : 'API Key'} è®¤è¯æ¹å¼`
                      : `This URL typically uses ${inferred === 'auth_token' ? 'Auth Token' : 'API Key'} authentication`}
                    {' '}
                    <Button
                      variant="link"
                      className="h-auto p-0 text-[11px] text-amber-500 underline hover:no-underline"
                      onClick={() => applyAuthStyleChange(inferred)}
                    >
                      {isZh ? 'åæ¢' : 'Switch'}
                    </Button>
                  </p>
                ) : null;
              })()}
            </div>
          )}

          {/* Model name â?for providers that need user-specified model */}
          {preset.fields.includes("model_names") && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('provider.modelName' as TranslationKey)}</Label>
              <Input
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder={preset.defaultModelId || "ark-code-latest"}
                className="text-sm font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                {isZh
                  ? 'å¨æå¡åæ§å¶å°éç½®çæ¨¡ååç§°ï¼å¯æ¹ä¸ºä½ è´¦å·å®éå¯ç¨çåå·'
                  : 'Model name as configured in the provider console â?change it to the model your account uses'}
              </p>
            </div>
          )}

          {/* Model mapping â?surfaced inline (was previously buried behind
              "Advanced options"). Only `anthropic-thirdparty` carries this
              field; flagged as éå¡« since defaults work for most users. */}
          {preset.fields.includes("model_mapping") && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                {isZh ? 'æ¨¡ååç§°æ å°ï¼éå¡«ï¼? : 'Model name mapping (optional)'}
              </Label>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {isZh
                  ? 'å¦ææå¡åä½¿ç¨ä¸åçæ¨¡ååç§°ï¼å¦ claude-sonnet-4-6ï¼ï¼å¨æ­¤æ å°ãçç©ºåä½¿ç¨é»è®¤åç§°ï¼sonnet / opus / haikuï¼ã?
                  : 'Map model names if the provider uses different IDs (e.g. claude-sonnet-4-6). Leave empty to use defaults (sonnet / opus / haiku).'}
              </p>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
                <span className="text-xs text-muted-foreground text-right">Sonnet</span>
                <Input
                  value={mapSonnet}
                  onChange={(e) => setMapSonnet(e.target.value)}
                  placeholder="claude-sonnet-4-6"
                  className="text-sm font-mono h-8"
                />
                <span className="text-xs text-muted-foreground text-right">Opus</span>
                <Input
                  value={mapOpus}
                  onChange={(e) => setMapOpus(e.target.value)}
                  placeholder="claude-opus-4-7"
                  className="text-sm font-mono h-8"
                />
                <span className="text-xs text-muted-foreground text-right">Haiku</span>
                <Input
                  value={mapHaiku}
                  onChange={(e) => setMapHaiku(e.target.value)}
                  placeholder="claude-haiku-4-5-20251001"
                  className="text-sm font-mono h-8"
                />
              </div>
            </div>
          )}

          {/* Advanced options â?edit-mode only.
              Create mode has nothing to show after the extra_env JSON input
              was removed and model_mapping was hoisted out, so the toggle
              would expand into emptiness; hide it entirely. */}
          {isEdit && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground h-auto px-0 py-0"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? <CaretUp size={12} /> : <CaretDown size={12} />}
                {t('provider.advancedOptions')}
              </Button>
              {showAdvanced && (
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      {t('provider.form.headersJson' as TranslationKey)}
                    </Label>
                    <Textarea
                      value={headersJson}
                      onChange={(e) => setHeadersJson(e.target.value)}
                      placeholder='{"X-Custom-Header": "value"}'
                      className="text-sm font-mono min-h-[60px]"
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      {t('provider.form.envOverridesJson' as TranslationKey)}
                    </Label>
                    <Textarea
                      value={envOverridesJson}
                      onChange={(e) => setEnvOverridesJson(e.target.value)}
                      placeholder='{"CLAUDE_CODE_USE_BEDROCK": "1"}'
                      className="text-sm font-mono min-h-[60px]"
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">{t('provider.notes')}</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={t('provider.notesPlaceholder')}
                      className="text-sm"
                      rows={2}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Connection test result */}
          {testResult && (() => {
            const isSkipped = testResult.error?.code === 'SKIPPED';
            const bgClass = testResult.success
              ? 'bg-emerald-500/10 border border-emerald-500/20' // lint-allow-raw-color
              : isSkipped
                ? 'bg-muted border border-border'
                : 'bg-destructive/10 border border-destructive/20';
            return (
              <div className={`rounded-md px-3 py-2 text-sm ${bgClass}`}>
                <div className="flex items-center gap-2">
                  {testResult.success
                    ? <><CheckCircle size={16} className="text-emerald-500 shrink-0" />{/* lint-allow-raw-color */}<span className="text-emerald-600 dark:text-emerald-400">{/* lint-allow-raw-color */}{isZh ? 'è¿æ¥æå' : 'Connection successful'}</span></>
                    : isSkipped
                      ? <><Warning size={16} className="text-muted-foreground shrink-0" /><span className="text-muted-foreground">{isZh ? 'æ­¤æå¡åç±»åæ æ³è¿è¡è¿æ¥æµè¯ï¼è¯·ä¿å­éç½®ååéæ¶æ¯éªè¯? : 'Connection test not available for this provider type'}</span></>
                      : <><XCircle size={16} className="text-destructive shrink-0" /><span className="text-destructive">{testResult.error?.message || 'Connection failed'}</span></>
                  }
                </div>
                {!testResult.success && !isSkipped && testResult.error?.suggestion && (
                  <p className="text-xs text-muted-foreground mt-1">{testResult.error.suggestion}</p>
                )}
                {!testResult.success && !isSkipped && testResult.error?.recoveryActions && testResult.error.recoveryActions.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {testResult.error.recoveryActions.filter(a => a.url).map((action, i) => (
                      <a key={i} href={action.url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <ArrowSquareOut size={10} />
                        {action.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving || testing}
            >
              {t('common.cancel')}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={saving || testing || !canTest}
                className="gap-1.5"
              >
                {testing ? <SpinnerGap size={14} className="animate-spin" /> : <BuckyballIcon name="diagnose" size="sm" aria-hidden />}
                {testing ? (isZh ? 'æµè¯ä¸?..' : 'Testing...') : (isZh ? 'æµè¯è¿æ¥' : 'Test')}
              </Button>
              <Button
                type="submit"
                disabled={saving || testing || !canTest}
                className="gap-2"
                title={!canTest ? (isZh ? 'è¯·åå¡«å API Key åè¿æ? : 'Fill the API Key before connecting') : undefined}
              >
                {saving && <SpinnerGap size={16} className="animate-spin" />}
                {saving ? t('provider.saving') : isEdit ? t('provider.update') : t('provider.connect')}
              </Button>
            </div>
          </DialogFooter>
        </form>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
