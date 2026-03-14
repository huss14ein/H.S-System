# Critical Bug Found in Household Budget Engine

## Issue: Emergency Gap Variable Being Modified During Loop

### Root Cause Identified

The `remainingEmergencyGap` variable is being modified inside the monthly loop (line 633), but it should be a separate calculation for each month.

**Problem Flow:**
1. Initial calculation: `remainingEmergencyGap = 19000` ✅
2. Month 1: `remainingEmergencyGap = Math.max(0, 19000 - 1583.33) = 17416.67`
3. Month 2: `remainingEmergencyGap = Math.max(0, 17416.67 - 1583.33) = 15833.34`
4. ... continues decreasing each month
5. By month 12: `remainingEmergencyGap = 0`

**Final result shows 0 because the gap is fully allocated across all 12 months.**

### The Bug

Line 633 in the monthly loop:
```typescript
remainingEmergencyGap = Math.max(0, remainingEmergencyGap - buckets.emergencySavings);
```

This modifies the global gap variable for each month, rather than calculating each month's allocation independently.

### Correct Behavior

Each month should calculate its allocation based on the **remaining gap at that time**, not modify the global gap calculation that gets returned in the final result.

### Fix Required

We need to track two separate values:
1. `initialEmergencyGap` - for the final result display
2. `remainingEmergencyGap` - for monthly allocation calculations

### Impact

- The `emergencyGap` in the final result always shows 0 after a full year calculation
- This makes it appear the emergency fund is fully funded when it may not be
- Users get incorrect recommendations about their emergency fund status
