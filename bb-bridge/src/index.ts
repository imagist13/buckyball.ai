export { startBridge } from "./server.js";
export type { BridgeServerOptions, BridgeRuntime } from "./server.js";

export {
  spawnPaseoDaemon,
  waitForPaseoReady,
  supervisePaseo,
} from "./paseo.js";
export type {
  PaseoSupervisor,
  PaseoSupervisorOptions,
  PaseoSupervisorEvent,
  SpawnFn,
  PingWsFn,
} from "./paseo.js";

export type {
  PaseoClient,
  PaseoClientOptions,
  PaseoProviderInfo,
  CreatePaseoClient,
} from "./paseo-types.js";
