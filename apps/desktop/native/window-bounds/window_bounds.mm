// Native Node addon (Objective-C++) — reads window/dock bounds via macOS
// Accessibility API IN-PROCESS so AvatarBox's TCC Accessibility grant
// applies (ad-hoc-signed child binaries don't inherit; this is the only
// path that works without paying for an Apple Developer Cert).
//
// Exports (CommonJS):
//   isAccessibilityTrusted() → bool
//   requestAccessibility()   → bool  (prompts user, opens System Settings)
//   getFocusedWindow()       → { x, y, w, h, app, bundle, title } | null
//   getDockBounds()          → { x, y, w, h, edge } | null
//   getScreenBounds()        → { x, y, w, h } | null

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <napi.h>

// ── Helpers ──────────────────────────────────────────────────────────────
static BOOL axPoint(AXUIElementRef el, CFStringRef attr, CGPoint *out) {
  CFTypeRef val = NULL;
  AXError err = AXUIElementCopyAttributeValue(el, attr, &val);
  if (err != kAXErrorSuccess || val == NULL) return NO;
  if (CFGetTypeID(val) != AXValueGetTypeID()) { CFRelease(val); return NO; }
  Boolean ok = AXValueGetValue((AXValueRef)val, (AXValueType)kAXValueCGPointType, out);
  CFRelease(val);
  return ok ? YES : NO;
}

static BOOL axSize(AXUIElementRef el, CFStringRef attr, CGSize *out) {
  CFTypeRef val = NULL;
  AXError err = AXUIElementCopyAttributeValue(el, attr, &val);
  if (err != kAXErrorSuccess || val == NULL) return NO;
  if (CFGetTypeID(val) != AXValueGetTypeID()) { CFRelease(val); return NO; }
  Boolean ok = AXValueGetValue((AXValueRef)val, (AXValueType)kAXValueCGSizeType, out);
  CFRelease(val);
  return ok ? YES : NO;
}

static NSString * axString(AXUIElementRef el, CFStringRef attr) {
  CFTypeRef val = NULL;
  AXError err = AXUIElementCopyAttributeValue(el, attr, &val);
  if (err != kAXErrorSuccess || val == NULL) return @"";
  NSString *s = @"";
  if (CFGetTypeID(val) == CFStringGetTypeID()) {
    s = (__bridge NSString *)val;
    s = [s copy];  // detach from CF lifetime
  }
  CFRelease(val);
  return s;
}

// ── isAccessibilityTrusted() ──────────────────────────────────────────────
static Napi::Value IsAccessibilityTrusted(const Napi::CallbackInfo &info) {
  NSDictionary *opts = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @NO};
  Boolean trusted = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts);
  return Napi::Boolean::New(info.Env(), trusted ? true : false);
}

// ── requestAccessibility() ────────────────────────────────────────────────
// Triggers the system prompt + registers AvatarBox in Settings.
static Napi::Value RequestAccessibility(const Napi::CallbackInfo &info) {
  NSDictionary *opts = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
  Boolean trusted = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts);
  return Napi::Boolean::New(info.Env(), trusted ? true : false);
}

// ── getFocusedWindow() ────────────────────────────────────────────────────
static Napi::Value GetFocusedWindow(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Pick the frontmost regular app that isn't AvatarBox itself.
  NSArray<NSRunningApplication *> *apps = [[NSWorkspace sharedWorkspace] runningApplications];

  for (NSRunningApplication *app in apps) {
    if (app.activationPolicy != NSApplicationActivationPolicyRegular) continue;
    if (!app.isActive) continue;
    NSString *bundle = app.bundleIdentifier ?: @"";
    if ([bundle isEqualToString:@"com.avatarbox.desktop"]) continue;
    if ([bundle isEqualToString:@"com.github.Electron"]) continue;

    pid_t pid = app.processIdentifier;
    AXUIElementRef axApp = AXUIElementCreateApplication(pid);
    if (!axApp) continue;

    CFTypeRef winRef = NULL;
    AXError err = AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute, &winRef);
    if (err != kAXErrorSuccess || winRef == NULL) {
      CFRelease(axApp);
      continue;
    }
    AXUIElementRef win = (AXUIElementRef)winRef;

    CGPoint pos = CGPointZero;
    CGSize size = CGSizeZero;
    if (!axPoint(win, kAXPositionAttribute, &pos) ||
        !axSize(win, kAXSizeAttribute, &size) ||
        size.width <= 50 || size.height <= 50) {
      CFRelease(winRef); CFRelease(axApp);
      continue;
    }

    NSString *title = axString(win, kAXTitleAttribute);

    Napi::Object out = Napi::Object::New(env);
    out.Set("x", Napi::Number::New(env, (double)pos.x));
    out.Set("y", Napi::Number::New(env, (double)pos.y));
    out.Set("w", Napi::Number::New(env, (double)size.width));
    out.Set("h", Napi::Number::New(env, (double)size.height));
    out.Set("app", Napi::String::New(env, [(app.localizedName ?: @"") UTF8String]));
    out.Set("bundle", Napi::String::New(env, [bundle UTF8String]));
    out.Set("title", Napi::String::New(env, [(title ?: @"") UTF8String]));

    CFRelease(winRef); CFRelease(axApp);
    return out;
  }

  return env.Null();
}

// ── getDockBounds() ───────────────────────────────────────────────────────
static Napi::Value GetDockBounds(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  NSRunningApplication *dockApp = nil;
  for (NSRunningApplication *app in [[NSWorkspace sharedWorkspace] runningApplications]) {
    if ([app.bundleIdentifier isEqualToString:@"com.apple.dock"]) { dockApp = app; break; }
  }
  if (!dockApp) return env.Null();

  AXUIElementRef axApp = AXUIElementCreateApplication(dockApp.processIdentifier);
  if (!axApp) return env.Null();

  CFTypeRef childrenRef = NULL;
  if (AXUIElementCopyAttributeValue(axApp, kAXChildrenAttribute, &childrenRef) != kAXErrorSuccess
      || childrenRef == NULL) { CFRelease(axApp); return env.Null(); }
  NSArray *children = (__bridge NSArray *)childrenRef;
  CGFloat screenW = [NSScreen mainScreen].frame.size.width;

  // The dock's "list" element (containing icons) has the real bounds.
  // Search direct children + one level deeper.
  Napi::Value result = env.Null();
  for (id obj in children) {
    AXUIElementRef el = (__bridge AXUIElementRef)obj;

    NSArray *pool = nil;
    CFTypeRef innerRef = NULL;
    if (AXUIElementCopyAttributeValue(el, kAXChildrenAttribute, &innerRef) == kAXErrorSuccess && innerRef) {
      pool = (__bridge NSArray *)innerRef;
    }
    NSMutableArray *all = [NSMutableArray array];
    [all addObject:obj];
    if (pool) [all addObjectsFromArray:pool];

    for (id cand in all) {
      AXUIElementRef ce = (__bridge AXUIElementRef)cand;
      CGPoint pos; CGSize size;
      if (axPoint(ce, kAXPositionAttribute, &pos) &&
          axSize(ce, kAXSizeAttribute, &size) &&
          size.width > 50 && size.height > 50) {
        const char *edge = "bottom";
        if (pos.x < 5) edge = "left";
        else if (pos.x + size.width > screenW - 5) edge = "right";

        Napi::Object out = Napi::Object::New(env);
        out.Set("x", Napi::Number::New(env, (double)pos.x));
        out.Set("y", Napi::Number::New(env, (double)pos.y));
        out.Set("w", Napi::Number::New(env, (double)size.width));
        out.Set("h", Napi::Number::New(env, (double)size.height));
        out.Set("edge", Napi::String::New(env, edge));
        result = out;
        if (innerRef) CFRelease(innerRef);
        goto done;
      }
    }
    if (innerRef) CFRelease(innerRef);
  }
done:
  CFRelease(childrenRef);
  CFRelease(axApp);
  return result;
}

// ── getScreenBounds() ─────────────────────────────────────────────────────
static Napi::Value GetScreenBounds(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  NSScreen *scr = [NSScreen mainScreen];
  if (!scr) return env.Null();
  Napi::Object out = Napi::Object::New(env);
  out.Set("x", Napi::Number::New(env, (double)scr.frame.origin.x));
  out.Set("y", Napi::Number::New(env, (double)scr.frame.origin.y));
  out.Set("w", Napi::Number::New(env, (double)scr.frame.size.width));
  out.Set("h", Napi::Number::New(env, (double)scr.frame.size.height));
  return out;
}

// ── getAllWindows() ───────────────────────────────────────────────────────
// Returns all on-screen windows (like Mate Engine's EnumWindows) using
// CGWindowListCopyWindowInfo — no Accessibility API needed for bounds.
// Returns array of { x, y, w, h, app, layer } sorted front-to-back (Z-order).
static Napi::Value GetAllWindows(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  pid_t myPid = [[NSProcessInfo processInfo] processIdentifier];

  CFArrayRef windowList = CGWindowListCopyWindowInfo(
    kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
    kCGNullWindowID);
  if (!windowList) return Napi::Array::New(env, 0);

  NSArray *windows = (__bridge NSArray *)windowList;
  Napi::Array result = Napi::Array::New(env);
  uint32_t idx = 0;

  for (NSDictionary *win in windows) {
    // Skip own process
    NSNumber *pidNum = win[(__bridge NSString *)kCGWindowOwnerPID];
    if (pidNum && [pidNum intValue] == myPid) continue;

    // Only normal windows (layer 0) and dock (layer > 0 but specific)
    NSNumber *layerNum = win[(__bridge NSString *)kCGWindowLayer];
    int layer = layerNum ? [layerNum intValue] : 0;
    if (layer != 0) continue; // skip menu bar, overlays, etc.

    // Get bounds
    NSDictionary *boundsDict = win[(__bridge NSString *)kCGWindowBounds];
    if (!boundsDict) continue;
    CGRect bounds;
    if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDict, &bounds)) continue;

    // Skip tiny windows (< 100x40)
    if (bounds.size.width < 100 || bounds.size.height < 40) continue;

    NSString *ownerName = win[(__bridge NSString *)kCGWindowOwnerName] ?: @"";
    // Skip Dock, SystemUIServer, Control Centre
    if ([ownerName isEqualToString:@"Dock"]) continue;
    if ([ownerName isEqualToString:@"SystemUIServer"]) continue;
    if ([ownerName isEqualToString:@"Control Centre"]) continue;
    if ([ownerName isEqualToString:@"Window Manager"]) continue;

    Napi::Object out = Napi::Object::New(env);
    out.Set("x", Napi::Number::New(env, (double)bounds.origin.x));
    out.Set("y", Napi::Number::New(env, (double)bounds.origin.y));
    out.Set("w", Napi::Number::New(env, (double)bounds.size.width));
    out.Set("h", Napi::Number::New(env, (double)bounds.size.height));
    out.Set("app", Napi::String::New(env, [ownerName UTF8String]));
    out.Set("layer", Napi::Number::New(env, layer));
    result.Set(idx++, out);
  }

  CFRelease(windowList);
  return result;
}

// ── Module init ──────────────────────────────────────────────────────────
static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isAccessibilityTrusted", Napi::Function::New(env, IsAccessibilityTrusted));
  exports.Set("requestAccessibility",   Napi::Function::New(env, RequestAccessibility));
  exports.Set("getFocusedWindow",       Napi::Function::New(env, GetFocusedWindow));
  exports.Set("getAllWindows",          Napi::Function::New(env, GetAllWindows));
  exports.Set("getDockBounds",          Napi::Function::New(env, GetDockBounds));
  exports.Set("getScreenBounds",        Napi::Function::New(env, GetScreenBounds));
  return exports;
}

NODE_API_MODULE(window_bounds_native, Init)
