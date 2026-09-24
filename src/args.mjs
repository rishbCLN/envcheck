// Zero-dependency argument parsing. Kept pure so it is fully unit-testable.

export const HELP = `envcheck \u2014 check your project's environment is ready to run

Usage:
  envcheck [options]

Options:
      --config <file>  Path to the config file (default: envcheck.json)
      --init           Write a starter envcheck.json inferred from this project
      --json           Output a machine-readable JSON report
      --ci             Compact, color-free output (non-zero exit on any error)
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes:
  0  all required checks passed
  1  one or more required checks failed
  2  usage or configuration error

Examples:
  npx envcheck                  # check against envcheck.json (or infer one)
  envcheck --json               # machine-readable report for scripts/CI
  envcheck --config env.json    # use a custom config path
  envcheck --init               # scaffold an envcheck.json to edit

envcheck never prints environment variable values \u2014 only whether they are set.
`;

/**
 * Parse argv (excluding node + script path).
 * @param {string[]} argv
 * @returns {{ config: string|null, init: boolean, json: boolean, ci: boolean,
 *             help: boolean, version: boolean, errors: string[] }}
 */
export function parseArgs(argv) {
  const result = {
    config: null,
    init: false,
    json: false,
    ci: false,
    help: false,
    version: false,
    errors: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        result.help = true;
        break;
      case '-v':
      case '--version':
        result.version = true;
        break;
      case '--init':
        result.init = true;
        break;
      case '--json':
        result.json = true;
        break;
      case '--ci':
        result.ci = true;
        break;
      case '--config':
        if (i + 1 >= argv.length) {
          result.errors.push('--config requires a file path');
        } else {
          result.config = argv[++i];
        }
        break;
      default: {
        if (arg.startsWith('--config=')) {
          const value = arg.slice('--config='.length);
          if (value === '') result.errors.push('--config requires a file path');
          else result.config = value;
          break;
        }
        if (arg.length > 1 && arg.startsWith('-')) {
          result.errors.push(`unknown option: ${arg}`);
          break;
        }
        result.errors.push(`unexpected argument: ${arg}`);
      }
    }
  }

  return result;
}
