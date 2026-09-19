using System;
using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace DshDesktop;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // 兜底：未处理异常不闪退，记录到日志文件。
        DispatcherUnhandledException += (_, args) =>
        {
            try
            {
                var dir = Path.Combine(AppContext.BaseDirectory, "logs");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "dsh-gui-crash.log"),
                    $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {args.Exception}\n\n");
            }
            catch { /* ignore */ }
            args.Handled = true;
        };
    }
}
