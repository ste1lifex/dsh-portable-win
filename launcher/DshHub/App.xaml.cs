using System;
using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace DshHub;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // 兜底：任何未处理异常都不再让进程崩溃，而是记录到日志文件并继续。
        DispatcherUnhandledException += (_, args) =>
        {
            try
            {
                var dir = Path.Combine(AppContext.BaseDirectory, "logs");
                Directory.CreateDirectory(dir);
                var log = Path.Combine(dir, "dsh-gui-crash.log");
                File.AppendAllText(log,
                    $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {args.Exception}\n\n");
            }
            catch { /* ignore */ }
            args.Handled = true;
        };
    }
}
