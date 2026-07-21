using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class TikTokOptimizerLauncher
{
    private const string MutexName = "Local\\FXQYMethodDesktopApp";
    private const string ActivateEventName = "Local\\FXQYMethodActivate";
    private static Process backend;
    private static Mutex mutex;
    private static EventWaitHandle activateEvent;
    private static MainWindow window;
    private static string appUrl;

    [STAThread]
    private static void Main()
    {
        bool firstInstance;
        mutex = new Mutex(true, MutexName, out firstInstance);
        if (!firstInstance)
        {
            try { EventWaitHandle.OpenExisting(ActivateEventName).Set(); } catch { }
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        try
        {
            int port = FindAvailablePort();
            appUrl = "http://127.0.0.1:" + port;
            StartBackend(port);
            if (!WaitForServer(port, TimeSpan.FromSeconds(90)))
                throw new InvalidOperationException("The local video engine could not start. Restart Windows and try again.");

            activateEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ActivateEventName);
            window = new MainWindow(appUrl);
            ThreadPool.RegisterWaitForSingleObject(activateEvent, delegate
            {
                if (window != null && !window.IsDisposed)
                    window.BeginInvoke((MethodInvoker)delegate { window.RestoreAndActivate(); });
            }, null, Timeout.Infinite, false);
            Application.Run(window);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "FXQY Method could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            StopBackend();
            if (activateEvent != null) activateEvent.Dispose();
            if (mutex != null) mutex.Dispose();
        }
    }

    private static int FindAvailablePort()
    {
        TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static void StartBackend(int port)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, "runtime", "node.exe");
        string runner = Path.Combine(root, "scripts", "run.mjs");
        if (!File.Exists(node) || !File.Exists(runner))
            throw new FileNotFoundException("The installed application is incomplete. Please reinstall FXQY Method.");

        string dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FXQY Method", "Data");
        Directory.CreateDirectory(dataRoot);
        ProcessStartInfo info = new ProcessStartInfo
        {
            FileName = node,
            Arguments = Quote(runner) + " start",
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        info.EnvironmentVariables["NODE_ENV"] = "production";
        info.EnvironmentVariables["APP_HOST"] = "127.0.0.1";
        info.EnvironmentVariables["APP_PORT"] = port.ToString();
        info.EnvironmentVariables["APP_ORIGIN"] = appUrl;
        info.EnvironmentVariables["DATA_ROOT"] = dataRoot;
        info.EnvironmentVariables["NEXT_TELEMETRY_DISABLED"] = "1";
        backend = Process.Start(info);
        if (backend == null) throw new InvalidOperationException("The local video engine could not be launched.");
    }

    private static bool WaitForServer(int port, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            if (backend != null && backend.HasExited) return false;
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult connection = client.BeginConnect("127.0.0.1", port, null, null);
                    if (connection.AsyncWaitHandle.WaitOne(500) && client.Connected) return true;
                }
            }
            catch { }
            Thread.Sleep(200);
        }
        return false;
    }

    private static void StopBackend()
    {
        if (backend == null || backend.HasExited) return;
        try { backend.CloseMainWindow(); } catch { }
        try { if (!backend.WaitForExit(5000)) backend.Kill(); } catch { }
    }

    private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
}

internal sealed class MainWindow : Form
{
    private readonly WebView2 view;
    private readonly string url;

    internal MainWindow(string appUrl)
    {
        url = appUrl;
        Text = "FXQY Method";
        BackColor = Color.FromArgb(7, 10, 18);
        MinimumSize = new Size(900, 650);
        Size = new Size(1440, 900);
        StartPosition = FormStartPosition.CenterScreen;
        WindowState = FormWindowState.Maximized;
        view = new WebView2 { Dock = DockStyle.Fill, BackColor = BackColor };
        Controls.Add(view);
        Shown += async delegate
        {
            try
            {
                string userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FXQY Method", "WebView2");
                CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userData);
                await view.EnsureCoreWebView2Async(environment);
                view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                view.CoreWebView2.Settings.AreDevToolsEnabled = false;
                view.CoreWebView2.Settings.IsStatusBarEnabled = false;
                view.CoreWebView2.Navigate(url);
            }
            catch (Exception error)
            {
                MessageBox.Show("The desktop window could not start. Install or repair Microsoft Edge WebView2 Runtime, then try again.\n\n" + error.Message,
                    "FXQY Method", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        };
    }

    internal void RestoreAndActivate()
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show();
        Activate();
        BringToFront();
    }
}
