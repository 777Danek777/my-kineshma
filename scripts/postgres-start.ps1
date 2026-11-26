$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$storageDirectory = Join-Path $projectRoot 'storage'
$dataDirectory = Join-Path $storageDirectory 'postgres-data'
$pgCtl = Join-Path $storageDirectory 'postgres-runtime\pgsql\bin\pg_ctl.exe'
$logPath = Join-Path $storageDirectory 'postgres.log'

if (-not (Test-Path -LiteralPath $pgCtl -PathType Leaf)) {
    throw 'The local PostgreSQL binaries are missing from storage/postgres-runtime.'
}
if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION') -PathType Leaf)) {
    throw 'The local database has not been initialized in storage/postgres-data.'
}

& $pgCtl status -D $dataDirectory *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Output 'Local PostgreSQL is already running.'
    return
}

$arguments = @('start', '-D', ('"{0}"' -f $dataDirectory), '-l', ('"{0}"' -f $logPath), '-w', '-t', '30')
$process = Start-Process -FilePath $pgCtl -ArgumentList $arguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $storageDirectory 'postgres-start.log') `
    -RedirectStandardError (Join-Path $storageDirectory 'postgres-start-error.log')
if (-not $process.WaitForExit(45000)) {
    throw 'PostgreSQL startup timed out. Check storage/postgres.log before retrying.'
}
& $pgCtl status -D $dataDirectory *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'PostgreSQL did not start. Check storage/postgres.log and storage/postgres-start-error.log.'
}
Write-Output 'Local PostgreSQL started. Network access is limited by its loopback configuration.'
