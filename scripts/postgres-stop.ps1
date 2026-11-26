$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$storageDirectory = Join-Path $projectRoot 'storage'
$dataDirectory = Join-Path $storageDirectory 'postgres-data'
$pgCtl = Join-Path $storageDirectory 'postgres-runtime\pgsql\bin\pg_ctl.exe'

if (-not (Test-Path -LiteralPath $pgCtl -PathType Leaf)) {
    throw 'The local PostgreSQL binaries are missing from storage/postgres-runtime.'
}
if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION') -PathType Leaf)) {
    throw 'The local database has not been initialized in storage/postgres-data.'
}

& $pgCtl status -D $dataDirectory *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Output 'Local PostgreSQL is already stopped.'
    return
}

# Fast shutdown disconnects clients, rolls back open transactions, and flushes data safely.
$arguments = @('stop', '-D', ('"{0}"' -f $dataDirectory), '-m', 'fast', '-w', '-t', '30')
$process = Start-Process -FilePath $pgCtl -ArgumentList $arguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $storageDirectory 'postgres-stop.log') `
    -RedirectStandardError (Join-Path $storageDirectory 'postgres-stop-error.log')
if (-not $process.WaitForExit(45000)) {
    throw 'PostgreSQL shutdown timed out. Check storage/postgres-stop-error.log.'
}
& $pgCtl status -D $dataDirectory *> $null
if ($LASTEXITCODE -ne 3) {
    throw 'PostgreSQL did not stop. Check storage/postgres-stop-error.log.'
}
Write-Output 'Local PostgreSQL stopped safely.'
