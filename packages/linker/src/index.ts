export const PACKAGE_NAME = "@rnxbuild/linker";
export { buildLinkerArgs, type LinkerArgsInput } from "./args.js";
export {
  createLinker,
  type CommandRunner,
  type Linker,
  type LinkerOptions,
  type LinkResult,
  type ProcessResult,
} from "./linker.js";
