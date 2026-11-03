using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7CustodyWitness;

// A bounded, real Windows negative-open survey of individual ordinary files.
// This can be invoked only by a separately qualified Windows security owner
// with the retained original token and the exact source root. The service has
// no command, network endpoint, token acquisition or caller-controlled scope.
// A successful survey never proves complete writer exclusion, existing handle
// revocation, directory creation denial, alternate tokens, or relaunch fences.
internal sealed record OriginalR7WriterScopeObservation(
    string Classification,
    int FilesVisited,
    int NegativeOpenFiles,
    bool BoundedSampleAllDenied,
    bool OriginalPrincipalProvenanceAuthenticated,
    bool AllOriginalSourceWritersExcluded,
    bool ExistingWriterHandlesExcluded,
    bool DirectAndTaskRelaunchExcluded,
    bool ProtectedAuditVerified,
    bool SigningAuthorityGranted,
    bool LeaseReleaseAuthorized);

internal static class OriginalR7WriterScopePreflight
{
    internal const int MaxEntries = 128;
    internal const int MaxDirectories = 32;
    internal const int MaxDepth = 6;

    private static OriginalR7WriterScopeObservation Held(
        string code, int files = 0, int denied = 0, bool sample = false)
        => new(code, files, denied, sample, false, false, false, false, false, false, false);

    // Pure finite predicate tested independently. Positive does NOT imply
    // qualified Windows custody. Invalid/truncated/racing surveys hold.
    internal static OriginalR7WriterScopeObservation EvaluateCounts(
        int files, int denied, bool enumeratedWithoutError, bool sawUnsafeEntry)
    {
        if (files <= 0 || files > MaxEntries || denied < 0 || denied > files
            || !enumeratedWithoutError || sawUnsafeEntry)
            return Held("R7_SCOPE_SURVEY_INCOMPLETE_OR_UNSAFE");
        if (files != denied)
            return Held("R7_SCOPE_ONE_OR_MORE_FILES_NOT_DENIED", files, denied);
        return Held("R7_BOUNDED_FILE_OPENS_DENIED_NOT_CUSTODY", files, denied, true);
    }

    // OPEN_EXISTING access attempts on already present ordinary files only.
    // No source mutation, traversal through reparse points, token generation
    // or impersonation outside OriginalR7WriterAccessPreflight is performed.
    internal static OriginalR7WriterScopeObservation ObserveBoundedFiles(
        string root, SafeAccessTokenHandle originalToken, string expectedOriginalSid)
    {
        if (!OperatingSystem.IsWindows() || originalToken is null
            || originalToken.IsInvalid || originalToken.IsClosed
            || string.IsNullOrWhiteSpace(expectedOriginalSid)
            || !CanonicalLocalRoot(root))
            return Held("R7_SCOPE_INPUT_OR_ORIGINAL_TOKEN_UNAVAILABLE");

        int files = 0;
        int denied = 0;
        try
        {
            Stack<(DirectoryInfo directory, int depth)> pending = new();
            HashSet<string> seen = new(StringComparer.OrdinalIgnoreCase);
            pending.Push((new DirectoryInfo(root), 0));
            int directoryCount = 0;
            int entryCount = 0;
            while (pending.Count != 0)
            {
                (DirectoryInfo directory, int depth) = pending.Pop();
                if (++directoryCount > MaxDirectories || depth > MaxDepth
                    || !seen.Add(directory.FullName)
                    || (directory.Attributes & FileAttributes.ReparsePoint) != 0
                    || (directory.Attributes & FileAttributes.Directory) == 0)
                    return Held("R7_SCOPE_DIRECTORY_UNSAFE_OR_OVER_BUDGET");

                foreach (FileSystemInfo entry in directory.EnumerateFileSystemInfos())
                {
                    if (++entryCount > MaxEntries
                        || entry.FullName.Length > 240
                        || (entry.Attributes & FileAttributes.ReparsePoint) != 0)
                        return Held("R7_SCOPE_ENTRY_UNSAFE_OR_OVER_BUDGET");
                    if ((entry.Attributes & FileAttributes.Directory) != 0)
                    {
                        if (depth + 1 > MaxDepth)
                            return Held("R7_SCOPE_DEPTH_EXCEEDED");
                        pending.Push((new DirectoryInfo(entry.FullName), depth + 1));
                    }
                    else
                    {
                        if (++files > MaxEntries)
                            return Held("R7_SCOPE_FILE_BUDGET_EXCEEDED");
                        var result = OriginalR7WriterAccessPreflight.ObserveSingleTarget(
                            entry.FullName, originalToken, expectedOriginalSid);
                        if (!result.OneTargetNegativeWriteProbeObserved
                            || !result.SuppliedSidMatched || !result.TargetIdentityStable)
                            return Held("R7_SCOPE_NEGATIVE_OPEN_FAILED_CLOSED");
                        denied++;
                    }
                }
            }
            // Even if all ordinary files were denied at this instant, this
            // snapshot does not prove directory rights or exclude new files,
            // mappings, existing writer handles or different launch tokens.
            return EvaluateCounts(files, denied, true, false);
        }
        catch
        {
            // No private names, SIDs, tokens or exception details in receipts.
            return Held("R7_SCOPE_ENUMERATION_OR_NATIVE_PROBE_UNAVAILABLE");
        }
    }

    private static bool CanonicalLocalRoot(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > 220
            || !Path.IsPathFullyQualified(path) || path.StartsWith(@"\\")
            || path.Contains('/') || path.Contains('\0') || path.Length < 4
            || !char.IsAsciiLetter(path[0]) || path[1] != ':'
            || path[2] != '\\' || path.AsSpan(2).Contains(':'))
            return false;
        try
        {
            return String.Equals(path, Path.GetFullPath(path),
                StringComparison.OrdinalIgnoreCase)
                && path.Split('\\', StringSplitOptions.None)
                    .Skip(1).All(part => part.Length > 0 && part is not "." and not ".."
                        && !part.EndsWith('.') && !part.EndsWith(' '));
        }
        catch { return false; }
    }
}
