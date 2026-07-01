export const PACKAGE_NAME = "@rnxbuild/clang-compiler";
export { buildClangArgs, type ClangArgsInput } from "./args.js";
export {
  createClangCompiler,
  type ClangCompiler,
  type ClangCompilerOptions,
  type CompileResult,
  type CommandRunner,
  type ProcessResult,
} from "./compiler.js";
