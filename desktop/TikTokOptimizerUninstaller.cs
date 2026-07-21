using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class TikTokOptimizerUninstaller
{
    private const string MutexName = "Local\\FXQYMethodDesktopApp";

    [STAThread]
    private static void Main()
    {
        using (Mutex appMutex = new Mutex(false, MutexName))
        {
            bool appIsClosed = false;
            try { appIsClosed = appMutex.WaitOne(0); } catch { }
            if (!appIsClosed)
            {
                MessageBox.Show(
                    "Close FXQY Method from its system-tray Exit command, then run the uninstaller again.",
                    "FXQY Method is running",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            DialogResult answer = MessageBox.Show(
                "Remove FXQY Method from this computer?\n\nYour locally stored videos, exports, history and settings will be kept.",
                "Uninstall FXQY Method",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (answer != DialogResult.Yes) return;

            string installRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            DeleteShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FXQY Method.lnk"));
            DeleteShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "FXQY Method.lnk"));
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FXQYMethod", false); } catch { }

            string escaped = installRoot.Replace("'", "''");
            string cleanup = "Start-Sleep -Seconds 2; Remove-Item -LiteralPath '" + escaped + "' -Recurse -Force -ErrorAction SilentlyContinue";
            string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(cleanup));
            Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -WindowStyle Hidden -EncodedCommand " + encoded,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });

            MessageBox.Show(
                "FXQY Method was uninstalled. Your local media and settings remain in Local AppData and can be removed from the app's Storage page before uninstalling if desired.",
                "Uninstall complete",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
    }

    private static void DeleteShortcut(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }
}
