param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$Icon
)
$ErrorActionPreference = 'Stop'
# Update a staging copy of our Electron executable. Never modify the shared runtime.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class CyporaExecutableIcon {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] data, uint length);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool EndUpdateResource(IntPtr handle, bool discard);
  static void Put(IntPtr handle, int type, int name, byte[] data) {
    if (!UpdateResource(handle, (IntPtr)type, (IntPtr)name, 1033, data, (uint)data.Length))
      throw new Win32Exception(Marshal.GetLastWin32Error());
  }
  public static int Apply(string exe, string icon) {
    byte[] ico = File.ReadAllBytes(icon);
    if (ico.Length < 6 || BitConverter.ToUInt16(ico,0) != 0 || BitConverter.ToUInt16(ico,2) != 1)
      throw new InvalidDataException("Expected a Windows ICO file");
    int count = BitConverter.ToUInt16(ico,4);
    if (count < 1 || count > 64 || ico.Length < 6 + 16 * count)
      throw new InvalidDataException("Invalid ICO directory");
    byte[] group = new byte[6 + 14 * count];
    Array.Copy(ico,0,group,0,6);
    byte[][] images = new byte[count][];
    for (int i=0; i<count; i++) {
      int entry = 6 + 16*i;
      uint size = BitConverter.ToUInt32(ico,entry+8), offset = BitConverter.ToUInt32(ico,entry+12);
      if (size == 0 || offset < 6 + 16*count || (ulong)offset + size > (ulong)ico.Length)
        throw new InvalidDataException("ICO image outside file");
      images[i] = new byte[size];
      Array.Copy(ico,(long)offset,images[i],0,(long)size);
      Array.Copy(ico,entry,group,6+14*i,12);
      Array.Copy(BitConverter.GetBytes((ushort)(5000+i)),0,group,6+14*i+12,2);
    }
    IntPtr handle = BeginUpdateResource(exe,false);
    if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      for (int i=0; i<count; i++) Put(handle,3,5000+i,images[i]);
      // Electron's application icon is RT_GROUP_ICON 1, en-US (1033).
      // Preserve dialogs, manifest, version metadata and other resource types.
      Put(handle,14,1,group);
      if (!EndUpdateResource(handle,false)) throw new Win32Exception(Marshal.GetLastWin32Error());
      handle = IntPtr.Zero;
    } finally {
      if (handle != IntPtr.Zero) EndUpdateResource(handle,true);
    }
    return count;
  }
}
'@
$taskImageCount = [CyporaExecutableIcon]::Apply([IO.Path]::GetFullPath($Executable), [IO.Path]::GetFullPath($Icon))
Write-Output "Embedded original Cypora icon ($taskImageCount sizes)"
