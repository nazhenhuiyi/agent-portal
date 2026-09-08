import { CliError } from "./errors.mjs";

// Load native bindings only when a command actually needs the credential store.
async function access(account, operation) {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return operation(new Entry("agent-portal", account));
  } catch {
    // Native diagnostics can contain credentials; never forward them.
    throw new CliError(
      "credential_store_unavailable",
      "Cannot access the OS credential store. Ensure it is available and unlocked for this user. No plaintext fallback is used.",
    );
  }
}

export const credentials = {
  get: (account) => access(account, (entry) => entry.getPassword()),
  set: (account, token) => access(account, (entry) => entry.setPassword(token)),
  delete: (account) => access(account, (entry) => entry.deletePassword()),
};
