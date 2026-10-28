using System.Text.Json;
using LibreHardwareMonitor.Hardware;

namespace Nexo.SensorHost;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static int Main()
    {
        Computer? computer = null;
        try
        {
            string? line;
            while ((line = Console.ReadLine()) is not null)
            {
                try
                {
                    computer ??= OpenComputer();
                    Console.WriteLine(JsonSerializer.Serialize(CreateSnapshot(computer), JsonOptions));
                }
                catch (Exception error)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new SensorSnapshot(
                        "error", DateTimeOffset.UtcNow, [], 0,
                        [new SensorIssue("Coletor", CleanError(error.Message))]), JsonOptions));
                }
            }
        }
        finally
        {
            computer?.Close();
        }

        return 0;
    }

    private static Computer OpenComputer()
    {
        var computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMemoryEnabled = true,
            IsMotherboardEnabled = true,
            IsStorageEnabled = true,
            IsNetworkEnabled = true,
            IsBatteryEnabled = true,
            IsPsuEnabled = true,
            IsPowerMonitorEnabled = true,
            IsControllerEnabled = true
        };

        try
        {
            computer.Open();
            return computer;
        }
        catch
        {
            computer.Close();
            throw;
        }
    }

    private static SensorSnapshot CreateSnapshot(Computer computer)
    {
        var devices = new List<HardwareEntry>();
        var issues = new List<SensorIssue>();
        foreach (IHardware hardware in computer.Hardware)
            ReadHardware(hardware, [], devices, issues);

        return new SensorSnapshot("ready", DateTimeOffset.UtcNow, devices,
            devices.Sum(device => device.Sensors.Count), issues);
    }

    private static void ReadHardware(IHardware hardware, IReadOnlyList<string> parentPath,
        ICollection<HardwareEntry> devices, ICollection<SensorIssue> issues)
    {
        string safeName = CleanName(hardware.Name);
        string[] path = [.. parentPath, safeName];
        try
        {
            hardware.Update();
            var sensors = hardware.Sensors.Select(sensor => new SensorEntry(
                CleanName(sensor.Name),
                sensor.SensorType.ToString(),
                Finite(sensor.Value),
                Finite(sensor.Min),
                Finite(sensor.Max),
                UnitFor(sensor.SensorType),
                sensor.IsDefaultHidden)).ToList();

            devices.Add(new HardwareEntry(safeName, hardware.HardwareType.ToString(),
                string.Join(" › ", path), sensors));
        }
        catch (Exception error)
        {
            issues.Add(new SensorIssue(safeName, CleanError(error.Message)));
        }

        foreach (IHardware child in hardware.SubHardware)
            ReadHardware(child, path, devices, issues);
    }

    private static float? Finite(float? value) => value is { } number && float.IsFinite(number) ? number : null;

    private static string UnitFor(SensorType type) => type switch
    {
        SensorType.Temperature => "°C",
        SensorType.Voltage => "V",
        SensorType.Current => "A",
        SensorType.Power => "W",
        SensorType.Clock => "MHz",
        SensorType.Frequency => "Hz",
        SensorType.Load or SensorType.Control or SensorType.Level or SensorType.Humidity => "%",
        SensorType.Fan => "RPM",
        SensorType.Flow => "L/h",
        SensorType.Data => "B",
        SensorType.Throughput => "B/s",
        SensorType.TimeSpan => "s",
        SensorType.Timing => "ns",
        SensorType.Energy => "mWh",
        SensorType.Noise => "dBA",
        SensorType.Conductivity => "µS/cm",
        _ => ""
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

    private sealed record SensorSnapshot(string Status, DateTimeOffset CollectedAt,
        IReadOnlyList<HardwareEntry> Devices, int SensorCount, IReadOnlyList<SensorIssue> Issues);
    private sealed record HardwareEntry(string Name, string Type, string Path, IReadOnlyList<SensorEntry> Sensors);
    private sealed record SensorEntry(string Name, string Type, float? Value, float? Min, float? Max,
        string Unit, bool Advanced);
    private sealed record SensorIssue(string Device, string Message);
}
