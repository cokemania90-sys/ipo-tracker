# IPO tracker deploy: commit changes -> push to GitHub -> wait for Pages deploy
# Usage: & D:\Claude\ipo-tracker\deploy.ps1 "commit message"
param([Parameter(Mandatory = $true)][string]$Message)

$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\Git\cmd;" + $env:Path
Set-Location $PSScriptRoot

$changes = git status --short
if (-not $changes) { Write-Output "no changes"; exit 0 }
Write-Output $changes

git add -A
git commit -q -m $Message -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git pull -q --rebase -X theirs origin main
git push -q origin main
$sha = (git rev-parse HEAD).Trim()
Write-Output ("pushed " + $sha.Substring(0, 7))

# Wait for the GitHub Actions deploy of this commit (max 5 min)
$api = "https://api.github.com/repos/humptys/ipo-tracker/actions/runs?per_page=5"
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 10
    try { $runs = (Invoke-RestMethod $api).workflow_runs } catch { continue }
    $run = $runs | Where-Object { $_.head_sha -eq $sha } | Select-Object -First 1
    if ($run -and $run.status -eq "completed") {
        Write-Output ("deploy " + $run.conclusion)
        try {
            $html = (Invoke-WebRequest -UseBasicParsing ("https://humptys.github.io/ipo-tracker/?x=" + (Get-Random))).Content
            if ($html -match 'app\.js\?v=([^"]+)') { Write-Output ("live " + $Matches[1]) }
        } catch {}
        if ($run.conclusion -ne "success") { exit 1 }
        exit 0
    }
}
Write-Output "timed out waiting for deploy (check the Actions tab)"
exit 1
