// Custom signing function for electron-builder using Azure Trusted Signing.
// Called by electron-builder for each executable/DLL that needs to be signed.
// Requires env vars: AZURE_CODE_SIGNING_DLIB, AZURE_METADATA_JSON,
//   AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID
//   and optionally SIGNTOOL_PATH.

const { execSync } = require("child_process");
const path = require("path");

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

// Only sign our app executable and the NSIS installer/uninstaller.
// Skip vendor & Electron framework binaries (already signed by their publishers).
const SIGN_PATTERNS = [/cSlope\.exe$/i, /Uninstall.*\.exe$/i];
const SKIP_DIRS = ["node_modules", "vendor"];

function shouldSign(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (SKIP_DIRS.some((dir) => normalized.includes(`/${dir}/`))) return false;
  const basename = path.basename(filePath);
  return SIGN_PATTERNS.some((pattern) => pattern.test(basename));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.default = async function sign(configuration) {
  if (!shouldSign(configuration.path)) {
    console.log(
      `Skipping signing (not app binary): ${path.basename(configuration.path)}`,
    );
    return;
  }

  const signtoolPath = process.env.SIGNTOOL_PATH || "signtool.exe";
  const dlib = process.env.AZURE_CODE_SIGNING_DLIB;
  const metadata = process.env.AZURE_METADATA_JSON;

  if (!dlib || !metadata) {
    throw new Error(
      "Azure Trusted Signing requires AZURE_CODE_SIGNING_DLIB and AZURE_METADATA_JSON env vars",
    );
  }

  const command = [
    `"${signtoolPath}"`,
    "sign",
    "/v",
    "/debug",
    "/fd",
    "SHA256",
    "/tr",
    "http://timestamp.acs.microsoft.com",
    "/td",
    "SHA256",
    "/dlib",
    `"${dlib}"`,
    "/dmdf",
    `"${metadata}"`,
    `"${configuration.path}"`,
  ].join(" ");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      execSync(command, { stdio: "inherit" });
      return; // success
    } catch (err) {
      const isFileLocked =
        err.message && err.message.includes("being used by another process");
      if (isFileLocked && attempt < MAX_RETRIES) {
        console.log(
          `Signing attempt ${attempt} failed (file locked), retrying in ${RETRY_DELAY_MS / 1000}s...`,
        );
        await sleep(RETRY_DELAY_MS);
      } else {
        throw err;
      }
    }
  }
};
