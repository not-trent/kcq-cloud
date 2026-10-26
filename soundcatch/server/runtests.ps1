$p = Start-Process -FilePath 'node' -ArgumentList '"e:/kcq cloud/soundcatch/server/node_modules/vitest/vitest.mjs"','run','test/api.test.ts' -WorkingDirectory 'e:/kcq cloud/soundcatch/server' -PassThru -RedirectStandardOutput 'e:/kcq cloud/soundcatch/server/vo.txt' -RedirectStandardError 'e:/kcq cloud/soundcatch/server/ve.txt'
Wait-Process -Id $p.Id -Timeout 60
if (!$p.HasExited) { Stop-Process -Id $p.Id -Force; 'TIMEOUT' } else { 'EXIT:' + $p.ExitCode }
