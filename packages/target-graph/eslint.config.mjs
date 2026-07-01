import rootConfig from "../../eslint.config.mjs";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "url";
import { dirname } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
export default tseslint.config(
  ...rootConfig,
  { files: ["test/**/*.ts"], languageOptions: { parserOptions: { projectService: false, project: "./tsconfig.test.json", tsconfigRootDir: __dirname } } },
);
