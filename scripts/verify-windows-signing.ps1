param(
  [Parameter(Mandatory = $true)][string]$ReleaseRoot,
  [Parameter(Mandatory = $true)][string]$ExpectedSubject
)

$ErrorActionPreference = 'Stop'
$installers = @(Get-ChildItem -Path $ReleaseRoot -Filter 'CodePilot.Setup.*.exe' -File)
if ($installers.Count -ne 1) {
  throw "Expected exactly one CodePilot NSIS installer, found $($installers.Count)"
}
$appExecutable = Join-Path (Join-Path $ReleaseRoot 'win-unpacked') 'CodePilot.exe'
if (-not (Test-Path -LiteralPath $appExecutable -PathType Leaf)) {
  throw "Expected the packaged CodePilot.exe"
}
# Verify only artifacts CodePilot owns. Electron/Chromium helpers and bundled
# third-party tools have independent publishers and must not be forced to match
# CodePilot's certificate subject.
$targets = @($installers[0], (Get-Item -LiteralPath $appExecutable))

foreach ($target in $targets) {
  $signature = Get-AuthenticodeSignature -FilePath $target.FullName
  if ($signature.Status -ne 'Valid') {
    throw "Authenticode status is not Valid for $($target.Name): $($signature.Status)"
  }
  if ($null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Subject -ne $ExpectedSubject) {
    throw "Authenticode publisher mismatch for $($target.Name)"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "Authenticode timestamp missing for $($target.Name)"
  }
  Write-Host "Authenticode OK: $($target.Name)"
}

Write-Host "Windows Authenticode publisher/timestamp OK: $($targets.Count) executable(s)"
