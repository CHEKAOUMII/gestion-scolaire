$excluded = @('login.html', 'grades.html', 'settings-imports.html')
$files = Get-ChildItem -Path 'd:\project 06' -Filter '*.html' -File | Where-Object { $excluded -notcontains $_.Name }

foreach ($f in $files) {
    $content = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
    $old = 'family=Tajawal:wght@300;400;500;700;800'
    $new = 'family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700'
    if ($content.Contains($old)) {
        $newContent = $content.Replace($old, $new)
        [System.IO.File]::WriteAllText($f.FullName, $newContent, [System.Text.Encoding]::UTF8)
        Write-Output "Updated: $($f.Name)"
    }
}
Write-Output "Done."
