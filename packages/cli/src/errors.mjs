export class CliError extends Error {
  constructor(code, message, exitCode = 2, details = {}) {
    super(message);
    Object.assign(this, { code, exitCode, details });
  }
}
