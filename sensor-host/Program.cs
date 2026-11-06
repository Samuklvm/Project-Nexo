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

    private static int RunChild()
    {
        using var reader = new SensorReader("child");
        string? line;
        while ((line = Console.ReadLine()) is not null)
            Console.WriteLine(reader.ReadJson());
        return 0;
    }
}

/** Desinstalação (chamada elevada pelo desinstalador do Nexo): serviço, pasta protegida, registro e o PawnIO se foi o Nexo que instalou. */
internal static class ServiceRemoval
{
    public static int Run()
    {
        string dest = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Nexo Device Care", "SensorService");
        Exec("sc.exe", $"stop {Program.PipeName}");
        Thread.Sleep(1000);
        Exec("sc.exe", $"delete {Program.PipeName}");
        using (var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\NexoDeviceCare\SensorService"))
        {
            bool byNexo = key?.GetValue("PawnIOByNexo") is int flag && flag == 1;
            string setup = Path.Combine(dest, "PawnIO_setup.exe");
            if (byNexo && File.Exists(setup)) Exec(setup, "-uninstall -silent", 120000);
        }
        try { if (Directory.Exists(dest)) Directory.Delete(dest, true); } catch { }
        try { string parent = Path.GetDirectoryName(dest)!; if (Directory.Exists(parent) && !Directory.EnumerateFileSystemEntries(parent).Any()) Directory.Delete(parent); } catch { }
        try { Microsoft.Win32.Registry.LocalMachine.DeleteSubKeyTree(@"SOFTWARE\NexoDeviceCare", false); } catch { }
        return 0;
    }

    private static void Exec(string file, string arguments, int timeoutMs = 20000)
    {
        try
        {
            using var process = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(file, arguments) { CreateNoWindow = true, UseShellExecute = false });
            process?.WaitForExit(timeoutMs);
        }
        catch { }
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
                _cached = JsonSerializer.Serialize(new SensorSnapshot("error", _source, Elevated(), DateTimeOffset.UtcNow, [], 0,
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

    private static bool Elevated()
    {
        using WindowsIdentity identity = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator) || identity.IsSystem;
    }

    private SensorSnapshot CreateSnapshot(Computer computer)
    {
        var devices = new List<HardwareEntry>();
        var issues = new List<SensorIssue>();
        foreach (IHardware hardware in computer.Hardware) ReadHardware(hardware, [], devices, issues);
        return new SensorSnapshot("ready", _source, Elevated(), DateTimeOffset.UtcNow, devices, devices.Sum(device => device.Sensors.Count), issues);
    }

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
        SensorType.Fan => "RPM", SensorType.Flow => "L/h", SensorType.Data => "B", SensorType.Throughput => "B/s",
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
            catch (Exception) when (token.IsCancellationRequested || !pipe.IsConnected) { }
            catch (IOException) { }
        }
    }
}
