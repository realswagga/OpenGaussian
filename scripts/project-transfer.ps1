param(
  [Parameter(Position=0, Mandatory=$true)][ValidateSet('export','validate','import','list')][string]$Command,
  [Parameter(ValueFromRemainingArguments=$true)][string[]]$TransferArgs
)
$ErrorActionPreference = 'Stop'

function Read-PlainPassphrase {
  $secure = Read-Host 'Transfer passphrase' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Invoke-Transfer([string[]]$Args) {
  $passphrase = Read-PlainPassphrase
  try { $passphrase | docker compose --profile tools run --rm -T transfer @Args }
  finally { $passphrase = $null }
  if ($LASTEXITCODE -ne 0) { throw "Transfer command failed with exit code $LASTEXITCODE" }
}

switch ($Command) {
  'export' {
    docker compose stop api worker
    try { Invoke-Transfer (@('export') + $TransferArgs) }
    finally { docker compose up -d api worker }
  }
  'validate' { Invoke-Transfer (@('validate') + $TransferArgs) }
  'import' {
    docker compose stop nginx public-web admin-web api worker
    try {
      Invoke-Transfer (@('import') + $TransferArgs)
      if ($TransferArgs -contains '--apply-config') {
        if (Test-Path '.env') { Copy-Item '.env' ("backups/.env.before-import-{0}" -f (Get-Date -Format 'yyyyMMddHHmmss')) }
        Copy-Item 'backups/runtime.env.imported' '.env' -Force
      }
    }
    finally { docker compose up -d }
  }
  'list' {
    docker compose --profile tools run --rm -T transfer list
    if ($LASTEXITCODE -ne 0) { throw "Transfer command failed with exit code $LASTEXITCODE" }
  }
}
