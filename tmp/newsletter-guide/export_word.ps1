param([string]$GuideDocx, [string]$GuidePdf)
$ErrorActionPreference = 'Stop'
$guideWord = $null
$guideDocument = $null
try {
    $guideWord = New-Object -ComObject Word.Application
    $guideWord.Visible = $false
    $guideWord.DisplayAlerts = 0
    $guideDocument = $guideWord.Documents.Open($GuideDocx, $false, $true, $false)
    $guideDocument.Repaginate()
    $guideDocument.ExportAsFixedFormat($GuidePdf, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $true, $false)
    Write-Output ('Exported PDF with ' + $guideDocument.ComputeStatistics(2) + ' pages')
} finally {
    if ($null -ne $guideDocument) { $guideDocument.Close(0); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($guideDocument) }
    if ($null -ne $guideWord) { $guideWord.Quit(0); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($guideWord) }
}
