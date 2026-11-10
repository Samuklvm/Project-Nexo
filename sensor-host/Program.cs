using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Nexo.SensorHost;

/*
 * Coletor de sensores do Nexo (LibreHardwareMonitor).
 *  - Sem argumentos: modo filho. O app escreve uma linha no stdin e recebe um JSON por linha no stdout.
 *    Roda com as permissões do usuário; sem o driver PawnIO, temperaturas do processador e da placa-mãe ficam sem acesso.
 *  - "--service": serviço do Windows "NexoSensors" (instalado pelo app com a permissão da pessoa, UAC).
 *    Roda com permissão de sistema, usa o driver PawnIO e responde SOMENTE leituras pelo pipe local
 *    \\.\pipe\NexoSensors: qualquer linha recebida = "me mande uma leitura". Não aceita nenhum outro comando,
 *    não lê arquivos e não executa nada. O pipe recusa conexões pela rede.
 *  - "--version": imprime a versão (o app reinstala o serviço quando ela muda).
 */
internal static class Program
{
    internal const string PipeName = "NexoSensors";
    internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Escolhe o modo pelo argumento: versão, remoção do serviço, serviço do Windows ou processo filho do app.</summary>
    private static int Main(string[] args)
    {
        if (args.Contains("--version"))
        {
            Console.WriteLine(typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "0.0.0");
            return 0;
        }
        if (args.Contains("--remove-service")) return ServiceRemoval.Run();
        if (args.Contains("--service"))
        {
            HostApplicationBuilder builder = Host.CreateApplicationBuilder();
            builder.Services.AddWindowsService(options => options.ServiceName = PipeName);
            builder.Services.AddHostedService<PipeService>();
            builder.Build().Run();
            return 0;
        }
        return RunChild();
    }

    /// <summary>Modo filho: cada linha recebida no stdin (o conteúdo não importa) vira uma leitura em JSON no stdout.</summary>
    private static int RunChild()
    {
        using var reader = new SensorReader("child");
        while (Console.ReadLine() is not null)
            Console.WriteLine(reader.ReadJson());
        return 0;
    }
}

/** Desinstalação (chamada elevada pelo desinstalador do Nexo): serviço, pasta protegida, registro e o PawnIO se foi o Nexo que instalou. */
internal static class ServiceRemoval
{
    /// <summary>
    /// Remove o serviço, a pasta protegida, a chave do Registro e o PawnIO (só se foi o Nexo que instalou).
    /// Cada passo é de melhor esforço: a desinstalação não pode parar no meio porque um item já não existe.
    /// </summary>
    public static int Run()
    {
        string dest = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Nexo Device Care", "SensorService");
        try
        {
            using var service = new System.ServiceProcess.ServiceController(Program.PipeName);
            if (service.Status != System.ServiceProcess.ServiceControllerStatus.Stopped)
            {
                service.Stop();
                service.WaitForStatus(System.ServiceProcess.ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(15));
            }
        }
        catch (Exception)
        {
            // Serviço ausente ou já parado: segue para o "sc delete", que resolve os dois casos.
        }
        // Caminho completo da pasta do sistema: este processo roda como administrador, então nada vem do PATH.
        Exec(Path.Combine(Environment.SystemDirectory, "sc.exe"), $"delete {Program.PipeName}");
        WaitForServiceProcess(Path.Combine(dest, "host", "Nexo.SensorHost.exe"));
        BestEffort(() =>
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\NexoDeviceCare\SensorService");
            bool byNexo = key?.GetValue("PawnIOByNexo") is int flag && flag == 1;
            string setup = Path.Combine(dest, "PawnIO_setup.exe");
            if (byNexo && File.Exists(setup)) Exec(setup, "-uninstall -silent", 120000);
        });
        BestEffort(() =>
        {
            if (Directory.Exists(dest)) Directory.Delete(dest, true);
        });
        BestEffort(() =>
        {
            string parent = Path.GetDirectoryName(dest)!;
            if (Directory.Exists(parent) && !Directory.EnumerateFileSystemEntries(parent).Any()) Directory.Delete(parent);
        });
        BestEffort(() => Microsoft.Win32.Registry.LocalMachine.DeleteSubKeyTree(@"SOFTWARE\NexoDeviceCare", false));
        return 0;
    }

    /// <summary>Roda um passo de limpeza que pode falhar sem impedir os outros (arquivo em uso, pasta já apagada).</summary>
    private static void BestEffort(Action step)
    {
        try
        {
            step();
        }
        catch (Exception)
        {
            // O que sobrar fica para o Windows remover no próximo reinício; a desinstalação continua.
        }
    }

    /// <summary>O processo do serviço segura os arquivos da pasta protegida; espera ele sair (e encerra se passar do tempo).</summary>
    private static void WaitForServiceProcess(string exePath)
    {
        for (int attempt = 0; attempt < 40; attempt++)
        {
            List<System.Diagnostics.Process> left = ServiceProcesses(exePath);
            if (left.Count == 0) return;
            if (attempt == 30) KillAll(left);
            Thread.Sleep(250);
        }
    }

    /// <summary>Processos do coletor que rodam a partir da pasta do serviço (nunca este próprio processo).</summary>
    private static List<System.Diagnostics.Process> ServiceProcesses(string exePath)
    {
        int self = Environment.ProcessId;
        return System.Diagnostics.Process.GetProcessesByName("Nexo.SensorHost").Where(process => process.Id != self && RunsFrom(process, exePath)).ToList();
    }

    /// <summary>Compara o executável do processo; um processo que já saiu ou sem acesso conta como "não é o serviço".</summary>
    private static bool RunsFrom(System.Diagnostics.Process process, string exePath)
    {
        try
        {
            return string.Equals(process.MainModule?.FileName, exePath, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception)
        {
            // Processo que já saiu ou de outro usuário (sem acesso ao módulo): não é o coletor desta pasta.
            return false;
        }
    }

    /// <summary>Encerra os processos que não saíram sozinhos; um que já saiu entre a leitura e o Kill é ignorado.</summary>
    private static void KillAll(IEnumerable<System.Diagnostics.Process> processes)
    {
        foreach (var process in processes)
        {
            try
            {
                process.Kill();
            }
            catch (Exception)
            {
                // Já saiu ou não pode ser encerrado: a espera continua e a pasta é apagada no que der.
            }
        }
    }

    /// <summary>Roda uma ferramenta do sistema sem janela e espera até o tempo limite.</summary>
    private static void Exec(string file, string arguments, int timeoutMs = 20000)
    {
        try
        {
            using var process = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(file, arguments) { CreateNoWindow = true, UseShellExecute = false });
            process?.WaitForExit(timeoutMs);
        }
        catch (Exception)
        {
            // Ferramenta ausente ou bloqueada: o passo é de melhor esforço e a desinstalação segue.
        }
    }
}

/** Abre o LibreHardwareMonitor uma vez e devolve leituras em JSON (com um pequeno cache). */
internal sealed class SensorReader : IDisposable
{
    private readonly string _source;
    private readonly object _gate = new();
    private Computer? _computer;
    private string? _cached;
    private DateTime _cachedAt = DateTime.MinValue;

    public SensorReader(string source) => _source = source;

    /// <summary>Uma leitura de todos os sensores em JSON (reaproveitada por até 0,9 s; um erro vira uma leitura com status "error").</summary>
    public string ReadJson()
    {
        lock (_gate)
        {
            if (_cached is not null && DateTime.UtcNow - _cachedAt < TimeSpan.FromMilliseconds(900)) return _cached;
            try
            {
                _computer ??= Open();
                _cached = JsonSerializer.Serialize(CreateSnapshot(_computer), Program.JsonOptions);
            }
            catch (Exception error)
            {
                _cached = JsonSerializer.Serialize(new SensorSnapshot("error", _source, RunningElevated(), DateTimeOffset.UtcNow, [], 0,
                    [new SensorIssue("Coletor", CleanError(error.Message))]), Program.JsonOptions);
            }
            _cachedAt = DateTime.UtcNow;
            return _cached;
        }
    }

    private static Computer Open()
    {
        var computer = new Computer
        {
            IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = true, IsMotherboardEnabled = true,
            IsStorageEnabled = true, IsNetworkEnabled = true, IsBatteryEnabled = true, IsPsuEnabled = true,
            IsPowerMonitorEnabled = true, IsControllerEnabled = true
        };
        try { computer.Open(); return computer; }
        catch { computer.Close(); throw; }
    }

    /// <summary>Se o coletor roda como administrador ou sistema (sem isso, parte dos sensores fica sem acesso).</summary>
    private static bool RunningElevated()
    {
        using WindowsIdentity identity = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator) || identity.IsSystem;
    }

    private SensorSnapshot CreateSnapshot(Computer computer)
    {
        var devices = new List<HardwareEntry>();
        var issues = new List<SensorIssue>();
        foreach (IHardware hardware in computer.Hardware) ReadHardware(hardware, [], devices, issues);
        return new SensorSnapshot("ready", _source, RunningElevated(), DateTimeOffset.UtcNow, devices, devices.Sum(device => device.Sensors.Count), issues);
    }

    /// <summary>Lê um componente e os subcomponentes dele; uma falha num componente vira um aviso e não para os outros.</summary>
    private static void ReadHardware(IHardware hardware, IReadOnlyList<string> parentPath, ICollection<HardwareEntry> devices, ICollection<SensorIssue> issues)
    {
        string safeName = CleanName(hardware.Name);
        string[] path = [.. parentPath, safeName];
        try
        {
            hardware.Update();
            var sensors = hardware.Sensors.Select(sensor => new SensorEntry(CleanName(sensor.Name), sensor.SensorType.ToString(),
                Finite(sensor.Value), Finite(sensor.Min), Finite(sensor.Max), UnitFor(sensor.SensorType), sensor.IsDefaultHidden)).ToList();
            devices.Add(new HardwareEntry(safeName, hardware.HardwareType.ToString(), string.Join(" › ", path), sensors));
        }
        catch (Exception error) { issues.Add(new SensorIssue(safeName, CleanError(error.Message))); }
        foreach (IHardware child in hardware.SubHardware) ReadHardware(child, path, devices, issues);
    }

    private static float? Finite(float? value) => value is { } number && float.IsFinite(number) ? number : null;

    private static string UnitFor(SensorType type) => type switch
    {
        SensorType.Temperature => "°C", SensorType.Voltage => "V", SensorType.Current => "A", SensorType.Power => "W",
        SensorType.Clock => "MHz", SensorType.Frequency => "Hz",
        SensorType.Load or SensorType.Control or SensorType.Level or SensorType.Humidity => "%",
        SensorType.Fan => "RPM", SensorType.Flow => "L/h", SensorType.Data => "GB", SensorType.SmallData => "MB", SensorType.Throughput => "B/s",
        SensorType.TimeSpan => "s", SensorType.Timing => "ns", SensorType.Energy => "mWh", SensorType.Noise => "dBA",
        SensorType.Conductivity => "µS/cm", _ => ""
    };

    private static string CleanName(string? value)
    {
        string cleaned = (value ?? "Hardware").Replace('\r', ' ').Replace('\n', ' ').Trim();
        return cleaned.Length > 120 ? cleaned[..120] : cleaned;
    }

    private static string CleanError(string? value)
    {
        string cleaned = (value ?? "Falha ao ler sensor").Replace('\r', ' ').Replace('\n', ' ').Trim();
        return cleaned.Length > 180 ? cleaned[..180] : cleaned;
    }

    public void Dispose() { lock (_gate) { _computer?.Close(); _computer = null; } }

    private sealed record SensorSnapshot(string Status, string Source, bool Elevated, DateTimeOffset CollectedAt,
        IReadOnlyList<HardwareEntry> Devices, int SensorCount, IReadOnlyList<SensorIssue> Issues);
    private sealed record HardwareEntry(string Name, string Type, string Path, IReadOnlyList<SensorEntry> Sensors);
    private sealed record SensorEntry(string Name, string Type, float? Value, float? Min, float? Max, string Unit, bool Advanced);
    private sealed record SensorIssue(string Device, string Message);
}

/** Serviço: atende o pipe local com leituras. Até 4 clientes ao mesmo tempo; nada além de leitura. */
internal sealed class PipeService : BackgroundService
{
    private readonly SensorReader _reader = new("service");

    /// <summary>Aceita conexões no pipe local até o serviço parar; cada cliente é atendido em paralelo (até 4).</summary>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var clients = new List<Task>();
        while (!stoppingToken.IsCancellationRequested)
        {
            NamedPipeServerStream server = NamedPipeServerStreamAcl.Create(Program.PipeName, PipeDirection.InOut, 4,
                PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 1 << 20, Security());
            try { await server.WaitForConnectionAsync(stoppingToken); }
            catch (OperationCanceledException) { await server.DisposeAsync(); break; }
            catch (IOException) { await server.DisposeAsync(); await Task.Delay(500, stoppingToken); continue; }
            clients.RemoveAll(task => task.IsCompleted);
            clients.Add(Serve(server, stoppingToken));
        }
        await Task.WhenAll(clients);
        _reader.Dispose();
    }

    /** Usuários conectados à máquina podem pedir leituras; acesso pela rede é negado. */
    private static PipeSecurity Security()
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.InteractiveSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        return security;
    }

    /// <summary>Atende um cliente: cada linha recebida (até 256 caracteres, conteúdo ignorado) recebe uma leitura.</summary>
    private async Task Serve(NamedPipeServerStream pipe, CancellationToken token)
    {
        await using (pipe)
        {
            using var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, leaveOpen: true);
            await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1 << 16, leaveOpen: true) { AutoFlush = true, NewLine = "\n" };
            try
            {
                var buffer = new char[256];
                while (!token.IsCancellationRequested && pipe.IsConnected)
                {
                    // Lê até o fim da linha, mas nunca guarda mais que 256 caracteres: o conteúdo é ignorado.
                    int read;
                    bool sawNewline = false;
                    while (!sawNewline && (read = await reader.ReadAsync(buffer.AsMemory(), token)) > 0)
                        sawNewline = Array.IndexOf(buffer, '\n', 0, read) >= 0;
                    if (!sawNewline) break;
                    await writer.WriteLineAsync(_reader.ReadJson().AsMemory(), token);
                }
            }
            catch (Exception) when (token.IsCancellationRequested || !pipe.IsConnected)
            {
                // O serviço está parando ou o app desconectou: fim normal da conversa com este cliente.
            }
            catch (IOException)
            {
                // Pipe quebrado pelo outro lado: o cliente reconecta quando precisar de outra leitura.
            }
        }
    }
}
