# Read the original file
$allLines = Get-Content 'timetable.html' -Encoding UTF8

# CSS part: lines 1-2035 (index 0-2034)
$cssLines = $allLines[0..2034]

# JS part: lines 2673-5681 (index 2672-5680)  
$jsLines = $allLines[2672..5680]

# Read the new body HTML
$bodyLines = Get-Content 'timetable_body.html' -Encoding UTF8

# Combine: CSS + body + JS
$combined = $cssLines + $bodyLines + $jsLines

# Write the combined file
Set-Content -Path 'timetable.html' -Value $combined -Encoding UTF8

Write-Host "Done! CSS: $($cssLines.Count), Body: $($bodyLines.Count), JS: $($jsLines.Count), Total: $($combined.Count)"
