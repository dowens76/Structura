/**
 * create-msix.mjs
 *
 * Creates a self-signed MSIX package from the Tauri Windows build output.
 * The MSIX is signed with a freshly-generated self-signed certificate whose
 * Subject matches the Publisher CN, so Windows will install it once the
 * accompanying .cer file is trusted on the target machine.
 *
 * For Microsoft Store submission the Store re-signs the package, so the
 * self-signed certificate is ignored on that path.
 *
 * Requires Windows SDK tools (makeappx.exe, signtool.exe) which are present
 * on GitHub Actions windows-latest runners.
 *
 * Environment variables:
 *   TAURI_BUILD_TARGET  - Rust target triple (default: x86_64-pc-windows-msvc)
 *   MSIX_PUBLISHER      - Publisher CN for AppxManifest, e.g.:
 *                         "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
 *                         Obtain from Partner Center → App identity.
 *                         Defaults to a placeholder; must be set for Store submission.
 *   MSIX_IDENTITY_NAME  - Package identity name (default: DanielOwens.Structura)
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

function runCapture(cmd) {
  return execSync(cmd, { encoding: "utf8", cwd: ROOT }).trim();
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
const identityName = process.env.MSIX_IDENTITY_NAME || "DanielOwens.Structura";
const publisher = process.env.MSIX_PUBLISHER || "CN=Structura-Dev";

// AppxManifest requires a valid X.509 Distinguished Name for Publisher.
// A bare "CN=value" is the minimum. Fail fast with a clear message rather than
// letting makeappx emit a cryptic schema error.
if (!/^(CN|L|O|OU|E|C|S|STREET|T|G|I|SN|DC|SERIALNUMBER|Description|PostalCode|POBox|Phone|X21Address|dnQualifier|OID\.\d[\d.]*)\s*=/.test(publisher)) {
  throw new Error(
    `MSIX_PUBLISHER value "${publisher}" is not a valid X.509 Distinguished Name.\n` +
    `Expected format: CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX\n` +
    `Check that the GitHub secret does not have surrounding quotes.`
  );
}

// ── Locate Windows SDK tools ──────────────────────────────────────────────────
function findWindowsSdkTool(toolName) {
  const sdkRoot = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  if (!existsSync(sdkRoot)) {
    throw new Error(`Windows SDK not found at ${sdkRoot}`);
  }
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
// Tauri's bundler strips the directory prefix and target triple from externalBin
// entries: "binaries/node-x86_64-pc-windows-msvc.exe" → "node.exe" next to the
// exe. The runtime call .sidecar("node") resolves to <exe_dir>/node.exe, so the
// MSIX staging must match that exact name and location.
const nodeSidecarSrc = path.join(ROOT, "src-tauri", "binaries", `node-${target}.exe`);
if (existsSync(nodeSidecarSrc)) {
  copyFileSync(nodeSidecarSrc, path.join(stagingDir, "node.exe"));
  console.log(`Copied sidecar: node-${target}.exe → node.exe`);
} else {
  console.warn(`Warning: sidecar not found at ${nodeSidecarSrc}`);
}

// ── Copy bundled resources ────────────────────────────────────────────────────
// Tauri's bundle.resources maps source paths (relative to src-tauri/) to
// destination paths (relative to resource_dir, which on Windows is the exe dir).
// We must replicate that mapping exactly so the app finds files at the same
// paths it expects at runtime (e.g. resource_dir/"server", resource_dir/"databases").
const bundleResources = tauriConf.bundle?.resources ?? {};
for (const [src, dst] of Object.entries(bundleResources)) {
  const srcAbs = path.join(ROOT, "src-tauri", src);
  const dstAbs = path.join(stagingDir, dst);
  if (!existsSync(srcAbs)) {
    console.warn(`Warning: resource source not found, skipping: ${src}`);
    continue;
  }
  mkdirSync(path.dirname(dstAbs), { recursive: true });
  cpSync(srcAbs, dstAbs, { recursive: true });
  console.log(`Copied resource: ${src} → ${dst}`);
}

// ── Copy icon assets ──────────────────────────────────────────────────────────
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
// runFullTrust is the only capability declared. It is mandatory for any
// Win32/desktop-bridge app (Tauri, Electron, etc.) — without it the OS will
// not launch the process. No additional capabilities are declared because
// Structura does not access the network, camera, microphone, location, or
// any other sensitive resource at the OS API level; all file I/O goes through
// the Tauri-managed app data directory.
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

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
    <TargetDeviceFamily
      Name="Windows.Desktop"
      MinVersion="10.0.17763.0"
      MaxVersionTested="10.0.26100.0" />
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
    </Application>
  </Applications>

  <Capabilities>
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

// ── Self-sign with a generated certificate ────────────────────────────────────
// A certificate whose Subject matches the Publisher CN is generated on the fly
// in the current user's certificate store, then used to sign the MSIX directly
// via its thumbprint (no PFX export needed). The public .cer is exported
// alongside the .msix so end users can install it into Trusted Root and
// sideload the package. The Store ignores this signature and re-signs.
const cerPath = path.join(msixOut, `Structura_${appVersion}_${arch}.cer`);

// PowerShell paths — forward slashes work fine in PS cmdlet parameters.
const cerPathPs = cerPath.replace(/\\/g, "/");
const msixPathPs = msixPath.replace(/\\/g, "/");

const psScript = `
$ErrorActionPreference = "Stop"
Import-Module PKI

$cert = New-SelfSignedCertificate \`
  -Type Custom \`
  -Subject "${publisher}" \`
  -KeyUsage DigitalSignature \`
  -FriendlyName "Structura MSIX Self-Sign" \`
  -CertStoreLocation "Cert:\\CurrentUser\\My" \`
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")

Write-Host "Generated cert thumbprint: $($cert.Thumbprint)"

# Export public CER for end-user trust installation.
# End users must import this into Local Machine > Trusted People (not Current User,
# not Trusted Root) — App Installer only checks Local Machine stores.
Export-Certificate -Cert $cert -FilePath "${cerPathPs}" -Type CERT | Out-Null
Write-Host "Exported CER: ${cerPathPs}"

# Sign the MSIX directly from the store using the thumbprint
& "${signtool.replace(/\\/g, "/")}" sign /fd SHA256 /sha1 $cert.Thumbprint /s My "${msixPathPs}"
if ($LASTEXITCODE -ne 0) { throw "signtool exited with code $LASTEXITCODE" }
Write-Host "Signed MSIX"

# Clean up — remove the cert from the personal store
Remove-Item -Path $cert.PSPath | Out-Null
Write-Host "Removed cert from store"
`;

const psScriptPath = path.join(ROOT, "src-tauri", "target", "sign-msix.ps1");
writeFileSync(psScriptPath, psScript, "utf8");
try {
  run(
    `pwsh -ExecutionPolicy Bypass -NonInteractive -File "${psScriptPath}"`,
    "Self-sign MSIX"
  );
} finally {
  if (existsSync(psScriptPath)) unlinkSync(psScriptPath);
}

console.log(`\n✓ MSIX created and signed: ${msixPath}`);
console.log(`  Version:   ${msixVersion}`);
console.log(`  Identity:  ${identityName}`);
console.log(`  Publisher: ${publisher}`);
console.log(`\n  To sideload on another machine (run PowerShell as Administrator):`);
console.log(`    Import-Certificate -FilePath "${path.basename(cerPath)}" -CertStoreLocation Cert:\\LocalMachine\\TrustedPeople`);
console.log(`    Then double-click the .msix to install.`);
console.log(`\n  NOTE: must be Local Machine > Trusted People — Current User stores`);
console.log(`  and Trusted Root will NOT work with App Installer.`);
