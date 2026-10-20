param(
  [Parameter(Mandatory=$true)][string]$SourceDirectory,
  [Parameter(Mandatory=$true)][string]$DestinationFile
)
$ErrorActionPreference='Stop'
$sourcePath=[System.IO.Path]::GetFullPath($SourceDirectory)
$destinationPath=[System.IO.Path]::GetFullPath($DestinationFile)
if(!(Test-Path -LiteralPath $sourcePath -PathType Container)){throw 'Source folder does not exist'}
if(Test-Path -LiteralPath $destinationPath){throw 'Release archive already exists; preserve it and choose a new version.'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $sourcePath,$destinationPath,
  [System.IO.Compression.CompressionLevel]::Optimal,$true
)
