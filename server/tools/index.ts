import { ToolRegistry } from "./registry.js";
import { browserExtract, browserOpen, browserScreenshot, researchCollect } from "./browserTools.js";
import { analysisCompare, artifactDelete, artifactRead, artifactWrite, reportFinalize, verifierCheck } from "./missionTools.js";

/** The allowlist: the engine can only ever dispatch to tools registered here. */
export function createRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(browserOpen)
    .register(browserExtract)
    .register(browserScreenshot)
    .register(researchCollect)
    .register(analysisCompare)
    .register(artifactWrite)
    .register(artifactRead)
    .register(artifactDelete)
    .register(verifierCheck)
    .register(reportFinalize);
}
