export { parseWorkspace, type Workspace, type WorkspaceProjectRef } from "./workspace.js";
export {
  parseProject,
  type XcodeProject,
  type XcodeNativeTarget,
  type XcodeBuildConfiguration,
  type BuildSettings,
} from "./project.js";
export {
  parseXcconfig,
  loadXcconfigChain,
  tokenizeXcconfigValue,
  type ParsedXcconfig,
  type XcconfigSetting,
} from "./xcconfig.js";
export { targetSourceFiles, resolveFileReferencePath } from "./sources.js";
