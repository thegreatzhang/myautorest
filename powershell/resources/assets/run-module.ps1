# ----------------------------------------------------------------------------------
${$project.pwshCommentHeader}
# ----------------------------------------------------------------------------------
param([switch]$Isolated, [switch]$Code)
$ErrorActionPreference = 'Stop'

if(-not $Isolated) {
  Write-Host -ForegroundColor Green 'Creating isolated process...'
  $pwsh = [System.Diagnostics.Process]::GetCurrentProcess().Path
  & "$pwsh" -NoExit -NoLogo -NoProfile -File $MyInvocation.MyCommand.Path @PSBoundParameters -Isolated
  return
}

$isAzure = $${$project.azure}
if($isAzure) {
  . (Join-Path $PSScriptRoot 'check-dependencies.ps1') -Isolated -Accounts
  # Load the latest version of Az.Accounts installed
  Import-Module -Name Az.Accounts -RequiredVersion (Get-Module -Name Az.Accounts -ListAvailable | Sort-Object -Property Version -Descending)[0].Version
}

$localModulesPath = Join-Path $PSScriptRoot '${$lib.path.relative($project.baseFolder, $project.dependencyModuleFolder)}'
if(Test-Path -Path $localModulesPath) {
  $env:PSModulePath = "$localModulesPath$([IO.Path]::PathSeparator)$env:PSModulePath"
}

$modulePsd1 = Get-Item -Path (Join-Path $PSScriptRoot '${$project.psd1}')
$modulePath = $modulePsd1.FullName
$moduleName = $modulePsd1.BaseName

function Prompt {
  Write-Host -NoNewline -ForegroundColor Green "PS $(Get-Location)"
  Write-Host -NoNewline -ForegroundColor Gray ' ['
  Write-Host -NoNewline -ForegroundColor White -BackgroundColor DarkCyan $moduleName
  ']> '
}

# where we would find the launch.json file
$vscodeDirectory = New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot '.vscode')
$launchJson = Join-Path $vscodeDirectory 'launch.json'

# if there is a launch.json file, let's just assume -Code, and update the file
if(($Code) -or (test-Path $launchJson) ) {
  $launchContent = '{ "version": "0.2.0", "configurations":[{ "name":"Attach to PowerShell", "type":"coreclr", "request":"attach", "processId":"' + ([System.Diagnostics.Process]::GetCurrentProcess().Id) + '", "justMyCode":false }] }'
  Set-Content -Path $launchJson -Value $launchContent
  if($Code) {
    # only launch vscode if they say -code
    code $PSScriptRoot
  }
}

Import-Module -Name $modulePath