using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace MailMindLauncher
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.Title = "MailMind AI - Intelligent Email Agent & Google Drive Sync";
            Console.OutputEncoding = Encoding.UTF8;

            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine(@"
========================================================================
       📬 MailMind AI — Windows Native Launcher & Auto-Sync
   Local Gemma AI · Gmail Intelligence · Date-Wise Drive Reporting
========================================================================
");
            Console.ResetColor();

            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            Directory.SetCurrentDirectory(appDir);

            Console.WriteLine("[1/5] 📁 App Directory: " + appDir);

            // Step 1: Check and Start Ollama if not running
            Console.Write("[2/5] 🦙 Checking Ollama AI status... ");
            if (IsOllamaRunning())
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("Online!");
                Console.ResetColor();
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("Offline. Starting Ollama serve automatically...");
                Console.ResetColor();

                StartOllamaServe();

                bool ready = false;
                for (int i = 0; i < 12; i++)
                {
                    Thread.Sleep(1000);
                    if (IsOllamaRunning())
                    {
                        ready = true;
                        break;
                    }
                    Console.Write(".");
                }

                if (ready)
                {
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine("\n[✓] 🦙 Ollama AI is now online and ready!");
                    Console.ResetColor();
                }
                else
                {
                    Console.ForegroundColor = ConsoleColor.DarkYellow;
                    Console.WriteLine("\n[!] ⚠️ Ollama did not respond in time. Proceeding; fallback rule categorization is active.");
                    Console.ResetColor();
                }
            }

            // Step 2: Check Node.js
            Console.Write("[3/5] 🟢 Checking Node.js runtime... ");
            string nodePath = FindExecutableOnPath("node.exe");
            if (string.IsNullOrEmpty(nodePath) && File.Exists(@"C:\Program Files\nodejs\node.exe"))
            {
                nodePath = @"C:\Program Files\nodejs\node.exe";
            }

            if (string.IsNullOrEmpty(nodePath))
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("Error: Node.js is not found on your system.");
                Console.WriteLine("Please install Node.js from https://nodejs.org (>= 22.13.0).");
                Console.ResetColor();
                Console.WriteLine("\nPress any key to exit...");
                Console.ReadKey();
                return;
            }

            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("Found (" + nodePath + ")");
            Console.ResetColor();

            // Step 3: Start MailMind AI Application
            Console.WriteLine("[4/5] 🚀 Starting MailMind AI server with auto-sync...");
            
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = "cmd.exe";
            startInfo.Arguments = "/c npm run dev";
            startInfo.WorkingDirectory = appDir;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = false;

            Process appProcess = null;
            try
            {
                appProcess = Process.Start(startInfo);
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("Failed to start MailMind: " + ex.Message);
                Console.ResetColor();
                Console.WriteLine("\nPress any key to exit...");
                Console.ReadKey();
                return;
            }

            // Step 4: Wait for server and open browser
            Console.Write("[5/5] 🌐 Waiting for MailMind Dashboard (http://127.0.0.1:8787)... ");
            bool serverReady = false;
            for (int i = 0; i < 20; i++)
            {
                Thread.Sleep(1000);
                if (IsServerResponding("http://127.0.0.1:8787/api/health"))
                {
                    serverReady = true;
                    break;
                }
                Console.Write(".");
            }

            if (serverReady)
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("\n[✓] 🌟 MailMind AI is running at http://127.0.0.1:8787!");
                Console.ResetColor();
                Console.WriteLine("[✓] 📊 Auto-sync initiated: primary inbox emails are being analyzed by Gemma, summarized into .docx, and uploaded to Google Drive.");
                
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo("http://127.0.0.1:8787");
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                }
                catch { }
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("\n[!] Server started. Open http://127.0.0.1:8787 in your browser.");
                Console.ResetColor();
            }

            Console.WriteLine("\nPress Ctrl+C or close this window to stop MailMind AI.");
            if (appProcess != null && !appProcess.HasExited)
            {
                appProcess.WaitForExit();
            }
        }

        static bool IsOllamaRunning()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:11434/api/tags");
                req.Timeout = 1800;
                req.Method = "GET";
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        static bool IsServerResponding(string url)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 1500;
                req.Method = "GET";
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        static void StartOllamaServe()
        {
            string ollamaPath = FindExecutableOnPath("ollama.exe");
            if (string.IsNullOrEmpty(ollamaPath))
            {
                string localAppOllama = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    @"Programs\Ollama\ollama.exe"
                );
                if (File.Exists(localAppOllama))
                {
                    ollamaPath = localAppOllama;
                }
            }

            if (!string.IsNullOrEmpty(ollamaPath))
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = ollamaPath;
                    psi.Arguments = "serve";
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    Process.Start(psi);
                }
                catch { }
            }
            else
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo("ollama", "serve");
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    Process.Start(psi);
                }
                catch { }
            }
        }

        static string FindExecutableOnPath(string exeName)
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (string.IsNullOrEmpty(pathEnv)) return null;

            string[] paths = pathEnv.Split(';');
            foreach (string p in paths)
            {
                string trimmed = p.Trim();
                if (string.IsNullOrEmpty(trimmed)) continue;
                try
                {
                    string fullPath = Path.Combine(trimmed, exeName);
                    if (File.Exists(fullPath)) return fullPath;
                }
                catch { }
            }
            return null;
        }
    }
}
