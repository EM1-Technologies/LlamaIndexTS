import { parse, stringify } from "smol-toml";
import { copy } from "../helpers/copy";
import { callPackageManager } from "../helpers/install";

import fs from "fs/promises";
import os from "os";
import path from "path";
import { bold, cyan } from "picocolors";
import { version } from "../../core/package.json";

import { COMMUNITY_OWNER, COMMUNITY_REPO } from "../helpers/constant";
import { PackageManager } from "../helpers/get-pkg-manager";
import { downloadAndExtractRepo } from "../helpers/repo";
import {
  InstallTemplateArgs,
  TemplateEngine,
  TemplateFramework,
  TemplateVectorDB,
} from "./types";

const createEnvLocalFile = async (
  root: string,
  opts?: {
    openAiKey?: string;
    vectorDb?: TemplateVectorDB;
    model?: string;
    framework?: TemplateFramework;
  },
) => {
  const envFileName = ".env";
  let content = "";

  const model = opts?.model || "gpt-3.5-turbo";
  content += `MODEL=${model}\n`;
  if (opts?.framework === "nextjs") {
    content += `NEXT_PUBLIC_MODEL=${model}\n`;
  }
  console.log("\nUsing OpenAI model: ", model, "\n");

  if (opts?.openAiKey) {
    content += `OPENAI_API_KEY=${opts?.openAiKey}\n`;
  }

  switch (opts?.vectorDb) {
    case "mongo": {
      content += `# For generating a connection URI, see https://www.mongodb.com/docs/guides/atlas/connection-string\n`;
      content += `MONGO_URI=\n`;
      content += `MONGODB_DATABASE=\n`;
      content += `MONGODB_VECTORS=\n`;
      content += `MONGODB_VECTOR_INDEX=\n`;
      break;
    }
  }

  if (content) {
    await fs.writeFile(path.join(root, envFileName), content);
    console.log(`Created '${envFileName}' file. Please check the settings.`);
  }
};

const copyTestData = async (
  root: string,
  framework: TemplateFramework,
  packageManager?: PackageManager,
  engine?: TemplateEngine,
  openAiKey?: string,
  vectorDb?: TemplateVectorDB,
) => {
  if (engine === "context") {
    const srcPath = path.join(__dirname, "components", "data");
    const destPath = path.join(root, "data");
    console.log(`\nCopying test data to ${cyan(destPath)}\n`);
    await copy("**", destPath, {
      parents: true,
      cwd: srcPath,
    });
  }

  if (packageManager && engine === "context") {
    const runGenerate = `${cyan(
      framework === "fastapi"
        ? "python app/engine/generate.py"
        : `${packageManager} run generate`,
    )}`;
    const hasOpenAiKey = openAiKey || process.env["OPENAI_API_KEY"];
    const hasVectorDb = vectorDb && vectorDb !== "none";
    const shouldRunGenerateAfterInstall =
      hasOpenAiKey && framework !== "fastapi" && vectorDb === "none";
    if (shouldRunGenerateAfterInstall) {
      console.log(`\nRunning ${runGenerate} to generate the context data.\n`);
      await callPackageManager(packageManager, true, ["run", "generate"]);
      console.log();
      return;
    }

    const settings = [];
    if (!hasOpenAiKey) settings.push("your OpenAI key");
    if (hasVectorDb) settings.push("your Vector DB environment variables");
    const settingsMessage =
      settings.length > 0 ? `After setting ${settings.join(" and ")}, ` : "";
    const generateMessage = `run ${runGenerate} to generate the context data.`;
    console.log(`\n${settingsMessage}${generateMessage}\n\n`);
  }
};

const rename = (name: string) => {
  switch (name) {
    case "gitignore":
    case "eslintrc.json": {
      return `.${name}`;
    }
    // README.md is ignored by webpack-asset-relocator-loader used by ncc:
    // https://github.com/vercel/webpack-asset-relocator-loader/blob/e9308683d47ff507253e37c9bcbb99474603192b/src/asset-relocator.js#L227
    case "README-template.md": {
      return "README.md";
    }
    default: {
      return name;
    }
  }
};

/**
 * Install a LlamaIndex internal template to a given `root` directory.
 */
const installTSTemplate = async ({
  appName,
  root,
  packageManager,
  isOnline,
  template,
  framework,
  engine,
  ui,
  eslint,
  customApiPath,
  forBackend,
  model,
  vectorDb,
}: InstallTemplateArgs) => {
  console.log(bold(`Using ${packageManager}.`));

  /**
   * Copy the template files to the target directory.
   */
  console.log("\nInitializing project with template:", template, "\n");
  const templatePath = path.join(__dirname, "types", template, framework);
  const copySource = ["**"];
  if (!eslint) copySource.push("!eslintrc.json");

  await copy(copySource, root, {
    parents: true,
    cwd: templatePath,
    rename,
  });

  /**
   * If the backend is next.js, rename next.config.app.js to next.config.js
   * If not, rename next.config.static.js to next.config.js
   */
  if (framework == "nextjs" && forBackend === "nextjs") {
    const nextConfigAppPath = path.join(root, "next.config.app.js");
    const nextConfigPath = path.join(root, "next.config.js");
    await fs.rename(nextConfigAppPath, nextConfigPath);
    // delete next.config.static.js
    const nextConfigStaticPath = path.join(root, "next.config.static.js");
    await fs.rm(nextConfigStaticPath);
  } else if (framework == "nextjs" && typeof forBackend === "undefined") {
    const nextConfigStaticPath = path.join(root, "next.config.static.js");
    const nextConfigPath = path.join(root, "next.config.js");
    await fs.rename(nextConfigStaticPath, nextConfigPath);
    // delete next.config.app.js
    const nextConfigAppPath = path.join(root, "next.config.app.js");
    await fs.rm(nextConfigAppPath);
  }

  /**
   * Copy the selected chat engine files to the target directory and reference it.
   */
  let relativeEngineDestPath;
  const compPath = path.join(__dirname, "components");
  if (engine && (framework === "express" || framework === "nextjs")) {
    console.log("\nUsing chat engine:", engine, "\n");

    let vectorDBFolder: string = engine;

    if (engine !== "simple" && vectorDb) {
      console.log("\nUsing vector DB:", vectorDb, "\n");
      vectorDBFolder = vectorDb;
    }

    const VectorDBPath = path.join(
      compPath,
      "vectordbs",
      "typescript",
      vectorDBFolder,
    );
    relativeEngineDestPath =
      framework === "nextjs"
        ? path.join("app", "api", "chat")
        : path.join("src", "controllers");
    await copy("**", path.join(root, relativeEngineDestPath, "engine"), {
      parents: true,
      cwd: VectorDBPath,
    });
  }

  /**
   * Copy the selected UI files to the target directory and reference it.
   */
  if (framework === "nextjs" && ui !== "shadcn") {
    console.log("\nUsing UI:", ui, "\n");
    const uiPath = path.join(compPath, "ui", ui);
    const destUiPath = path.join(root, "app", "components", "ui");
    // remove the default ui folder
    await fs.rm(destUiPath, { recursive: true });
    // copy the selected ui folder
    await copy("**", destUiPath, {
      parents: true,
      cwd: uiPath,
      rename,
    });
  }

  /**
   * Update the package.json scripts.
   */
  const packageJsonFile = path.join(root, "package.json");
  const packageJson: any = JSON.parse(
    await fs.readFile(packageJsonFile, "utf8"),
  );
  packageJson.name = appName;
  packageJson.version = "0.1.0";

  packageJson.dependencies = {
    ...packageJson.dependencies,
    llamaindex: version,
  };

  if (framework === "nextjs" && customApiPath) {
    console.log(
      "\nUsing external API with custom API path:",
      customApiPath,
      "\n",
    );
    // remove the default api folder
    const apiPath = path.join(root, "app", "api");
    await fs.rm(apiPath, { recursive: true });
    // modify the dev script to use the custom api path
    packageJson.scripts = {
      ...packageJson.scripts,
      dev: `cross-env NEXT_PUBLIC_CHAT_API=${customApiPath} next dev`,
    };
  }

  if (engine === "context" && relativeEngineDestPath) {
    // add generate script if using context engine
    packageJson.scripts = {
      ...packageJson.scripts,
      generate: `node ${path.join(
        relativeEngineDestPath,
        "engine",
        "generate.mjs",
      )}`,
    };
  }

  if (framework === "nextjs" && ui === "html") {
    // remove shadcn dependencies if html ui is selected
    packageJson.dependencies = {
      ...packageJson.dependencies,
      "tailwind-merge": undefined,
      "@radix-ui/react-slot": undefined,
      "class-variance-authority": undefined,
      clsx: undefined,
      "lucide-react": undefined,
      remark: undefined,
      "remark-code-import": undefined,
      "remark-gfm": undefined,
      "remark-math": undefined,
      "react-markdown": undefined,
      "react-syntax-highlighter": undefined,
    };

    packageJson.devDependencies = {
      ...packageJson.devDependencies,
      "@types/react-syntax-highlighter": undefined,
    };
  }

  if (!eslint) {
    // Remove packages starting with "eslint" from devDependencies
    packageJson.devDependencies = Object.fromEntries(
      Object.entries(packageJson.devDependencies).filter(
        ([key]) => !key.startsWith("eslint"),
      ),
    );
  }
  await fs.writeFile(
    packageJsonFile,
    JSON.stringify(packageJson, null, 2) + os.EOL,
  );

  console.log("\nInstalling dependencies:");
  for (const dependency in packageJson.dependencies)
    console.log(`- ${cyan(dependency)}`);

  console.log("\nInstalling devDependencies:");
  for (const dependency in packageJson.devDependencies)
    console.log(`- ${cyan(dependency)}`);

  console.log();

  await callPackageManager(packageManager, isOnline);
};

interface IDependencyItem {
  name: string;
  version: string;
}

const getPythonAddOnDependencies = (vectorDb?: TemplateVectorDB) => {
  const addOnDependencies: IDependencyItem[] = [];

  switch (vectorDb) {
    case "mongo": {
      addOnDependencies.push({
        name: "pymongo",
        version: "^4.6.1",
      });
      break;
    }
  }

  return addOnDependencies;
};

const preparePythonDependencies = async (
  root: string,
  addOnDependencies: IDependencyItem[],
) => {
  if (addOnDependencies.length === 0) return;

  const FILENAME = "pyproject.toml";
  try {
    // Parse toml file
    const file = path.join(root, FILENAME);
    const fileContent = await fs.readFile(file, "utf8");
    const fileParsed = parse(fileContent);

    // Modify toml dependencies
    const tool = fileParsed.tool as any;
    const dependencies = tool.poetry.dependencies as any;
    for (const dependency of addOnDependencies) {
      dependencies[dependency.name] = dependency.version;
    }

    // Write toml file
    const newFileContent = stringify(fileParsed);
    await fs.writeFile(file, newFileContent);

    const dependenciesString = addOnDependencies.map((d) => d.name).join(", ");
    console.log(`\nAdded ${dependenciesString} to ${cyan(FILENAME)}\n`);
  } catch (error) {
    console.log(
      `Error when preparing ${FILENAME} file for Python template\n`,
      error,
    );
    console.log(error);
  }
};

const installPythonTemplate = async ({
  root,
  template,
  framework,
  engine,
  vectorDb,
}: Pick<
  InstallTemplateArgs,
  "root" | "framework" | "template" | "engine" | "vectorDb"
>) => {
  console.log("\nInitializing Python project with template:", template, "\n");
  const templatePath = path.join(__dirname, "types", template, framework);
  await copy("**", root, {
    parents: true,
    cwd: templatePath,
    rename(name) {
      switch (name) {
        case "gitignore": {
          return `.${name}`;
        }
        // README.md is ignored by webpack-asset-relocator-loader used by ncc:
        // https://github.com/vercel/webpack-asset-relocator-loader/blob/e9308683d47ff507253e37c9bcbb99474603192b/src/asset-relocator.js#L227
        case "README-template.md": {
          return "README.md";
        }
        default: {
          return name;
        }
      }
    },
  });

  if (engine === "context") {
    const compPath = path.join(__dirname, "components");
    const VectorDBPath = path.join(
      compPath,
      "vectordbs",
      "python",
      vectorDb || "none",
    );
    await copy("**", path.join(root, "app", "engine"), {
      parents: true,
      cwd: VectorDBPath,
    });
  }

  const addOnDependencies = getPythonAddOnDependencies(vectorDb);
  await preparePythonDependencies(root, addOnDependencies);

  console.log(
    "\nPython project, dependencies won't be installed automatically.\n",
  );
};

const installCommunityProject = async ({
  root,
  communityProjectPath,
}: Pick<InstallTemplateArgs, "root" | "communityProjectPath">) => {
  console.log("\nInstalling community project:", communityProjectPath!);
  await downloadAndExtractRepo(root, {
    username: COMMUNITY_OWNER,
    name: COMMUNITY_REPO,
    branch: "main",
    filePath: communityProjectPath!,
  });
};

export const installTemplate = async (
  props: InstallTemplateArgs & { backend: boolean },
) => {
  process.chdir(props.root);

  if (props.template === "community" && props.communityProjectPath) {
    await installCommunityProject(props);
    return;
  }

  if (props.framework === "fastapi") {
    await installPythonTemplate(props);
  } else {
    await installTSTemplate(props);
  }

  if (props.backend) {
    // This is a backend, so we need to copy the test data and create the env file.

    // Copy the environment file to the target directory.
    await createEnvLocalFile(props.root, {
      openAiKey: props.openAiKey,
      vectorDb: props.vectorDb,
      model: props.model,
      framework: props.framework,
    });

    // Copy test pdf file
    await copyTestData(
      props.root,
      props.framework,
      props.packageManager,
      props.engine,
      props.openAiKey,
      props.vectorDb,
    );
  }
};

export * from "./types";
