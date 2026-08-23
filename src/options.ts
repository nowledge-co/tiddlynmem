export type ImportCommand = "apply" | "plan";
export type ImportMode = "migrate" | "sync";

export interface ImportOptions {
  apiUrl: string;
  command: ImportCommand;
  includeSensitive: boolean;
  jobs: number;
  limit: number;
  mode: ImportMode;
  spaceId: string;
  tag: string;
  wikiId: string;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} requires a positive integer.`);
  }
  return parsed;
}

export function parseArgs(args: string[]): ImportOptions {
  const options: ImportOptions = {
    apiUrl: "",
    command: "plan",
    includeSensitive: false,
    jobs: 4,
    limit: Number.POSITIVE_INFINITY,
    mode: "sync",
    spaceId: "default",
    tag: "",
    wikiId: "",
  };
  let commandSpecified = false;
  let planOptionSpecified = false;

  const takeValue = (index: number, option: string): string => {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a value.`);
    }
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    switch (option) {
      case "--":
        break;
      case "apply":
      case "plan":
        if (commandSpecified) {
          throw new Error("Only one command may be specified.");
        }
        options.command = option;
        commandSpecified = true;
        break;
      case "--api-url":
        planOptionSpecified = true;
        options.apiUrl = takeValue(index, option);
        index += 1;
        break;
      case "--include-sensitive":
        planOptionSpecified = true;
        options.includeSensitive = true;
        break;
      case "--jobs": {
        planOptionSpecified = true;
        const value = takeValue(index, option);
        options.jobs = positiveInteger(value, option);
        index += 1;
        break;
      }
      case "--limit": {
        planOptionSpecified = true;
        const value = takeValue(index, option);
        options.limit = positiveInteger(value, option);
        index += 1;
        break;
      }
      case "--mode": {
        planOptionSpecified = true;
        const value = takeValue(index, option);
        if (value !== "sync" && value !== "migrate") {
          throw new Error("--mode must be sync or migrate.");
        }
        options.mode = value;
        index += 1;
        break;
      }
      case "--space-id":
        planOptionSpecified = true;
        options.spaceId = takeValue(index, option);
        index += 1;
        break;
      case "--tag":
        planOptionSpecified = true;
        if (options.tag) {
          throw new Error("--tag may only be specified once.");
        }
        options.tag = takeValue(index, option);
        index += 1;
        break;
      case "--wiki-id": {
        planOptionSpecified = true;
        const value = takeValue(index, option).trim();
        if (!value) {
          throw new Error("--wiki-id requires a non-empty value.");
        }
        options.wikiId = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${option}`);
    }
  }

  if (options.command === "apply" && planOptionSpecified) {
    throw new Error(
      'apply does not accept plan options. Run "tiddlynmem plan [options]" first, then run "tiddlynmem apply".',
    );
  }

  return options;
}
