/**
 * create-msix.mjs
 *
 * Creates an MSIX package from the Tauri Windows build output for
 * submission to the Microsoft Store.
 *
 * Requires Windows SDK tools (makeappx.exe) which are present on
 * GitHub Actions windows-latest runners.
 *
 * Environment variables:
 *   TAURI_BUILD_TARGET     - Rust target triple (default: x86_64-pc-windows-msvc)
 *   MSIX_PUBLISHER         - Publisher CN for AppxManifest, e.g.:
 *                            "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
 *                            Obtain from Partner Center → App identity.
 *                            Defaults to a placeholder; set before Store submission.
 *   MSIX_IDENTITY_NAME     - Package identity name (default: DanielOwens.Structura)
 *   WINDOWS_CODESIGN_P12   - Base64-encoded PFX certificate for local signing (optional).
 *                            Required for local sideloading; not needed for Store upload.
 *   WINDOWS_CODESIGN_PASSWORD - Password for the PFX certificate (optional).
 */

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(cmd, label, opts = {}) {
  console.log(`\n▶ ${label ?? cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

// ── Resolve build target ──────────────────────────────────────────────────────
const target = process.env.TAURI_BUILD_TARGET || "x86_64-pc-windows-msvc";
const isArm64 = target.startsWith("aarch64");
const arch = isArm64 ? "arm64" : "x64";
const releaseDir = path.join(ROOT, "src-tauri", "target", target, "release");

// ── Read version from tauri.conf.json ────────────────────────────────────────
const tauriConf = JSON.parse(
  readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")
);
const appVersion = tauriConf.version; // e.g. "0.8.2"
const msixVersion = appVersion + ".0"; // Store requires 4-part version

// ── Package identity ──────────────────────────────────────────────────────────
// Partner Center → Your app → App identity → "Package/Identity/Name" and
// "Package/Identity/Publisher". Set these as GitHub secrets before submitting.
const identityName =
  process.env.MSIX_IDENTITY_NAME || "DanielOwens.Structura";
const publisher =
  process.env.MSIX_PUBLISHER ||
  "CN=Structura-Dev"; // placeholder — replace with Partner Center value

// ── Locate Windows SDK tools ──────────────────────────────────────────────────
function findWindowsSdkTool(toolName) {
  const sdkRoot = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  if (!existsSync(sdkRoot)) {
    throw new Error(`Windows SDK not found at ${sdkRoot}`);
  }
  // Enumerate SDK versions (e.g. 10.0.22621.0) newest-first
  const versions = readdirSync(sdkRoot)
    .filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d))
    .sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
      return 0;
    });
  for (const ver of versions) {
    const candidate = path.join(sdkRoot, ver, "x64", toolName);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${toolName} not found in Windows SDK under ${sdkRoot}`);
}

const makeappx = findWindowsSdkTool("makeappx.exe");
const signtool = findWindowsSdkTool("signtool.exe");
console.log(`makeappx: ${makeappx}`);
console.log(`signtool: ${signtool}`);

// ── Staging directory ─────────────────────────────────────────────────────────
const stagingDir = path.join(ROOT, "src-tauri", "target", "msix-staging");
if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true });
mkdirSync(stagingDir, { recursive: true });
mkdirSync(path.join(stagingDir, "Assets"), { recursive: true });

// ── Copy app executable ───────────────────────────────────────────────────────
const exeSrc = path.join(releaseDir, "Structura.exe");
if (!existsSync(exeSrc)) {
  throw new Error(`Structura.exe not found at ${exeSrc}. Run tauri build first.`);
}
copyFileSync(exeSrc, path.join(stagingDir, "Structura.exe"));
console.log("Copied Structura.exe");

// ── Copy sidecar Node binary ──────────────────────────────────────────────────
const nodeSidecarName = `node-${target}.exe`;
const nodeSidecarSrc = path.join(ROOT, "src-tauri", "binaries", nodeSidecarName);
if (existsSync(nodeSidecarSrc)) {
  mkdirSync(path.join(stagingDir, "binaries"), { recursive: true });
  copyFileSync(nodeSidecarSrc, path.join(stagingDir, "binaries", nodeSidecarName));
  console.log(`Copied sidecar: ${nodeSidecarName}`);
} else {
  console.warn(`Warning: sidecar not found at ${nodeSidecarSrc}`);
}

// ── Copy bundled resources ────────────────────────────────────────────────────
// Tauri places resources in <releaseDir>/resources/ at runtime.
// The staging dir under src-tauri/resources is what was prepared by tauri-build.mjs.
const resourcesSrc = path.join(ROOT, "src-tauri", "resources");
const resourcesDst = path.join(stagingDir, "resources");
if (existsSync(resourcesSrc)) {
  cpSync(resourcesSrc, resourcesDst, { recursive: true });
  console.log("Copied resources/");
} else {
  console.warn(`Warning: src-tauri/resources not found at ${resourcesSrc}`);
}

// ── Copy icon assets ──────────────────────────────────────────────────────────
// Tauri generates these Square*Logo.png files in src-tauri/icons/ via
// `tauri icon`. Copy all of them into Assets/.
const iconsDir = path.join(ROOT, "src-tauri", "icons");
const assetNames = [
  "Square30x30Logo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square89x89Logo.png",
  "Square107x107Logo.png",
  "Square142x142Logo.png",
  "Square150x150Logo.png",
  "Square284x284Logo.png",
  "Square310x310Logo.png",
  "StoreLogo.png",
];
for (const asset of assetNames) {
  const src = path.join(iconsDir, asset);
  if (existsSync(src)) {
    copyFileSync(src, path.join(stagingDir, "Assets", asset));
  } else {
    console.warn(`Warning: missing icon asset ${asset}`);
  }
}

// ── Write AppxManifest.xml ────────────────────────────────────────────────────
// runFullTrust capability is required for Win32/desktop apps (Tauri apps
// are full-trust because they are not sandboxed UWP apps).
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap3 rescap">

  <Identity
    Name="${identityName}"
    Publisher="${publisher}"
    Version="${msixVersion}"
    ProcessorArchitecture="${arch}" />

  <Properties>
    <DisplayName>Structura</DisplayName>
    <PublisherDisplayName>Daniel Owens</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>

  <Dependencies>
    <!-- Windows 10 version 1809 (build 17763) is the minimum for MSIX desktop apps -->
    <TargetDeviceFamily
      Name="Windows.Desktop"
      MinVersion="10.0.17763.0"
      MaxVersion="10.0.99999.0" />
  </Dependencies>

  <Resources>
    <Resource Language="en-US" />
  </Resources>

  <Applications>
    <Application Id="App"
      Executable="Structura.exe"
      EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Structura"
        Description="Biblical language reading and analysis tools"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png">
        <uap:DefaultTile
          Square71x71Logo="Assets\\Square71x71Logo.png"
          Square310x310Logo="Assets\\Square310x310Logo.png"
          Wide310x150Logo="Assets\\Square310x310Logo.png"
          ShortName="Structura" />
        <uap:SplashScreen Image="Assets\\Square150x150Logo.png" />
      </uap:VisualElements>
      <Extensions>
        <!-- Allow the app to launch in the background (required for sidecar Node server) -->
        <uap3:Extension Category="windows.appExecutionAlias">
          <uap3:AppExecutionAlias>
            <uap3:ExecutionAlias Alias="Structura.exe" />
          </uap3:AppExecutionAlias>
        </uap3:Extension>
      </Extensions>
    </Application>
  </Applications>

  <Capabilities>
    <!-- runFullTrust is required for all non-UWP/desktop bridge apps -->
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>

</Package>
`;
writeFileSync(path.join(stagingDir, "AppxManifest.xml"), manifest, "utf8");
console.log("Wrote AppxManifest.xml");

// ── Run makeappx pack ─────────────────────────────────────────────────────────
const msixName = `Structura_${appVersion}_${arch}.msix`;
const msixOut = path.join(ROOT, "src-tauri", "target", target, "release", "bundle", "msix");
mkdirSync(msixOut, { recursive: true });
const msixPath = path.join(msixOut, msixName);

if (existsSync(msixPath)) unlinkSync(msixPath);

run(
  `"${makeappx}" pack /d "${stagingDir}" /p "${msixPath}" /o`,
  `makeappx pack → ${msixName}`
);

// ── Optional: sign with a local certificate ───────────────────────────────────
// This is only needed for local sideloading/testing, NOT for Store submission.
// The Store re-signs the package with Microsoft's certificate upon ingestion.
const p12B64 = process.env.WINDOWS_CODESIGN_P12;
if (p12B64) {
  const pfxPath = path.join(ROOT, "src-tauri", "target", "codesign.pfx");
  writeFileSync(pfxPath, Buffer.from(p12B64, "base64"));
  const password = process.env.WINDOWS_CODESIGN_PASSWORD || "";
  try {
    run(
      `"${signtool}" sign /fd SHA256 /p "${password}" /f "${pfxPath}" "${msixPath}"`,
      "signtool sign (local cert)"
    );
  } finally {
    unlinkSync(pfxPath);
  }
} else {
  console.log("\n⚠  WINDOWS_CODESIGN_P12 not set — MSIX will not be signed.");
  console.log("   This is fine for Microsoft Store submission; the Store signs it.");
  console.log("   Set WINDOWS_CODESIGN_P12 + WINDOWS_CODESIGN_PASSWORD to sign locally.");
}

console.log(`\n✓ MSIX created: ${msixPath}`);
console.log(`  Version:   ${msixVersion}`);
console.log(`  Identity:  ${identityName}`);
console.log(`  Publisher: ${publisher}`);
