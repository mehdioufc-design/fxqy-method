using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal sealed class InstallerForm : Form
{
    private readonly Label status;
    private readonly ProgressBar progress;
    private readonly Button installButton;
    private readonly CheckBox desktopShortcut;
    private readonly CheckBox launchAfterInstall;

    internal InstallerForm()
    {
        Text = "FXQY Method Setup";
        ClientSize = new Size(590, 390);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(10, 15, 17);
        ForeColor = Color.FromArgb(230, 239, 238);
        Font = new Font("Segoe UI", 10F);

        Label eyebrow = new Label();
        eyebrow.Text = "LOCAL HARDWARE VIDEO WORKSTATION";
        eyebrow.ForeColor = Color.FromArgb(96, 226, 199);
        eyebrow.Font = new Font("Segoe UI Semibold", 9F);
        eyebrow.Location = new Point(42, 36);
        eyebrow.AutoSize = true;
        Controls.Add(eyebrow);

        Label title = new Label();
        title.Text = "Install FXQY Method";
        title.Font = new Font("Segoe UI Semibold", 24F);
        title.Location = new Point(38, 65);
        title.Size = new Size(510, 48);
        Controls.Add(title);

        Label description = new Label();
        description.Text = "Everything is included: the desktop launcher, local processing worker, Node runtime, FFmpeg and FFprobe. Videos are processed with this computer's own CPU or supported GPU.";
        description.ForeColor = Color.FromArgb(153, 170, 172);
        description.Location = new Point(42, 123);
        description.Size = new Size(500, 58);
        Controls.Add(description);

        desktopShortcut = new CheckBox();
        desktopShortcut.Text = "Create a Desktop shortcut";
        desktopShortcut.Checked = true;
        desktopShortcut.Location = new Point(45, 199);
        desktopShortcut.AutoSize = true;
        Controls.Add(desktopShortcut);

        launchAfterInstall = new CheckBox();
        launchAfterInstall.Text = "Open FXQY Method after installation";
        launchAfterInstall.Checked = true;
        launchAfterInstall.Location = new Point(45, 230);
        launchAfterInstall.AutoSize = true;
        Controls.Add(launchAfterInstall);

        progress = new ProgressBar();
        progress.Location = new Point(45, 276);
        progress.Size = new Size(500, 15);
        progress.Style = ProgressBarStyle.Continuous;
        Controls.Add(progress);

        status = new Label();
        status.Text = "Ready to install for this Windows account.";
        status.ForeColor = Color.FromArgb(153, 170, 172);
        status.Location = new Point(43, 302);
        status.Size = new Size(360, 28);
        Controls.Add(status);

        installButton = new Button();
        installButton.Text = "Install";
        installButton.BackColor = Color.FromArgb(37, 178, 151);
        installButton.ForeColor = Color.FromArgb(4, 20, 18);
        installButton.FlatStyle = FlatStyle.Flat;
        installButton.FlatAppearance.BorderSize = 0;
        installButton.Font = new Font("Segoe UI Semibold", 10F);
        installButton.Location = new Point(425, 329);
        installButton.Size = new Size(120, 38);
        installButton.Click += BeginInstall;
        Controls.Add(installButton);
        AcceptButton = installButton;
    }

    private void BeginInstall(object sender, EventArgs eventArgs)
    {
        installButton.Enabled = false;
        desktopShortcut.Enabled = false;
        launchAfterInstall.Enabled = false;
        progress.Style = ProgressBarStyle.Marquee;
        status.Text = "Installing the private desktop application…";

        bool createDesktop = desktopShortcut.Checked;
        bool launch = launchAfterInstall.Checked;
        BackgroundWorker worker = new BackgroundWorker();
        worker.DoWork += delegate { Install(createDesktop); };
        worker.RunWorkerCompleted += delegate(object completedSender, RunWorkerCompletedEventArgs completed)
        {
            progress.Style = ProgressBarStyle.Continuous;
            if (completed.Error != null)
            {
                progress.Value = 0;
                status.Text = "Installation could not be completed.";
                installButton.Text = "Try again";
                installButton.Enabled = true;
                desktopShortcut.Enabled = true;
                launchAfterInstall.Enabled = true;
                MessageBox.Show(completed.Error.Message, "FXQY Method Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            progress.Value = 100;
            status.Text = "Installation complete.";
            installButton.Text = "Finish";
            installButton.Enabled = true;
            installButton.Click -= BeginInstall;
            installButton.Click += delegate { Close(); };
            if (launch)
            {
                try { Process.Start(Path.Combine(InstallRoot(), "FXQY Method.exe")); } catch { }
            }
        };
        worker.RunWorkerAsync();
    }

    private static void Install(bool createDesktopShortcut)
    {
        using (Mutex appMutex = new Mutex(false, "Local\\FXQYMethodDesktopApp"))
        {
            bool appIsClosed = false;
            try { appIsClosed = appMutex.WaitOne(0); } catch { }
            if (!appIsClosed) throw new InvalidOperationException("FXQY Method is currently running. Exit it from the system tray, then run Setup again.");

            string installRoot = InstallRoot();
            if (Directory.Exists(installRoot)) Directory.Delete(installRoot, true);
            Directory.CreateDirectory(installRoot);

            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream payload = assembly.GetManifestResourceStream("FXQYMethod.Payload.zip"))
            {
                if (payload == null) throw new InvalidDataException("The installer payload is missing.");
                using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read, false))
                {
                    archive.ExtractToDirectory(installRoot);
                }
            }

            string launcher = Path.Combine(installRoot, "FXQY Method.exe");
            string uninstaller = Path.Combine(installRoot, "Uninstall FXQY Method.exe");
            if (!File.Exists(launcher) || !File.Exists(uninstaller)) throw new InvalidDataException("The installed application is incomplete.");

            CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "FXQY Method.lnk"), launcher, installRoot);
            string desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FXQY Method.lnk");
            if (createDesktopShortcut) CreateShortcut(desktop, launcher, installRoot);
            else if (File.Exists(desktop)) File.Delete(desktop);

            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FXQYMethod"))
            {
                key.SetValue("DisplayName", "FXQY Method");
                key.SetValue("DisplayVersion", "1.8.0");
                key.SetValue("Publisher", "FXQY Method");
                key.SetValue("InstallLocation", installRoot);
                key.SetValue("DisplayIcon", launcher);
                key.SetValue("UninstallString", "\"" + uninstaller + "\"");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }
    }

    private static void CreateShortcut(string shortcutPath, string launcher, string workingDirectory)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(shellType);
        dynamic shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath = launcher;
        shortcut.WorkingDirectory = workingDirectory;
        shortcut.Description = "Open FXQY Method";
        shortcut.IconLocation = Environment.GetFolderPath(Environment.SpecialFolder.System) + "\\shell32.dll,220";
        shortcut.Save();
    }

    private static string InstallRoot()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "FXQY Method");
    }
}

internal static class TikTokOptimizerSetup
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new InstallerForm());
    }
}
