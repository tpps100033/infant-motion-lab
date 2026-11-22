param([int]$Port = 8050)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$ResearchPython = Join-Path $PSScriptRoot 'server/.venv/Scripts/python.exe'
$ResearchDataPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MotionLabResearch'
if (-not (Test-Path -LiteralPath $ResearchPython)) {
    python -m venv server/.venv
    if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12 or newer, then run again.' }
    & $ResearchPython -m pip install -r server/requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& $ResearchPython -m server.manage init --write-credentials --port $Port --data-dir $ResearchDataPath
if ($LASTEXITCODE -ne 0) { throw 'Research database initialization failed.' }
$ResearchPrincipal = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $ResearchDataPath /inheritance:r /grant:r ($ResearchPrincipal + ':(OI)(CI)F') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict the research data folder to the current Windows account.' }
Write-Host "Research platform: http://127.0.0.1:$Port/research.html"
Write-Host 'Initial login: %LOCALAPPDATA%/MotionLabResearch/initial-login.txt'
& $ResearchPython -m server.manage serve --port $Port --data-dir $ResearchDataPath
