#import "mac_notification.h"
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#import <AppKit/AppKit.h>
#include <stdio.h>

static bool is_valid_ptt_article_url_ns(NSString *urlString) {
    if (!urlString || [urlString length] == 0) {
        return false;
    }
    NSURL *url = [NSURL URLWithString:urlString];
    if (!url) {
        return false;
    }
    NSString *scheme = [[url scheme] lowercaseString];
    if (![scheme isEqualToString:@"https"]) {
        return false;
    }
    NSString *host = [[url host] lowercaseString];
    if (!host || (![host isEqualToString:@"www.ptt.cc"] && ![host isEqualToString:@"ptt.cc"])) {
        return false;
    }
    NSArray *components = [url pathComponents];
    // Must be ["/", "bbs", "<board>", "<file>.html"]
    if ([components count] != 4) {
        return false;
    }
    if (![components[1] isEqualToString:@"bbs"]) {
        return false;
    }
    NSString *board = components[2];
    NSString *file = components[3];
    if (![file hasSuffix:@".html"]) {
        return false;
    }

    static NSRegularExpression *boardRegex = nil;
    static NSRegularExpression *fileRegex = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        boardRegex = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_.-]+$" options:0 error:nil];
        fileRegex = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_.-]+\\.html$" options:0 error:nil];
    });

    if ([boardRegex numberOfMatchesInString:board options:0 range:NSMakeRange(0, [board length])] == 0) {
        return false;
    }
    if ([fileRegex numberOfMatchesInString:file options:0 range:NSMakeRange(0, [file length])] == 0) {
        return false;
    }

    return true;
}

bool is_valid_ptt_article_url_c(const char *url) {
    if (!url) return false;
    @autoreleasepool {
        NSString *str = [NSString stringWithUTF8String:url];
        return is_valid_ptt_article_url_ns(str);
    }
}

@interface WaterballNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
+ (instancetype)sharedDelegate;
@end

@implementation WaterballNotificationDelegate

+ (instancetype)sharedDelegate {
    static WaterballNotificationDelegate *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[WaterballNotificationDelegate alloc] init];
    });
    return instance;
}

// Present notification banner, list & sound even if Waterball is currently active in the foreground
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler {
    (void)center;
    BOOL hasSound = (notification.request.content.sound != nil);
    if (@available(macOS 11.0, *)) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        UNNotificationPresentationOptions opts =
            UNNotificationPresentationOptionBanner |
            UNNotificationPresentationOptionList |
            UNNotificationPresentationOptionAlert;
#pragma clang diagnostic pop
        if (hasSound) {
            opts |= UNNotificationPresentationOptionSound;
        }
        completionHandler(opts);
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        UNNotificationPresentationOptions opts = UNNotificationPresentationOptionAlert;
        if (hasSound) {
            opts |= UNNotificationPresentationOptionSound;
        }
        completionHandler(opts);
#pragma clang diagnostic pop
    }
}

// Handle notification user click / interaction
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
    (void)center;
    // Only open the URL if the user explicitly clicked the notification banner (default action)
    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
        NSDictionary *userInfo = response.notification.request.content.userInfo;
        if (userInfo) {
            id urlObj = userInfo[@"url"];
            if ([urlObj isKindOfClass:[NSString class]]) {
                NSString *urlString = (NSString *)urlObj;
                if (is_valid_ptt_article_url_ns(urlString)) {
                    NSURL *url = [NSURL URLWithString:urlString];
                    if (url) {
                        if ([NSThread isMainThread]) {
                            [[NSWorkspace sharedWorkspace] openURL:url];
                        } else {
                            dispatch_sync(dispatch_get_main_queue(), ^{
                                [[NSWorkspace sharedWorkspace] openURL:url];
                            });
                        }
                    }
                }
            }
        }
    }
    completionHandler();
}

@end

static BOOL is_running_in_app_bundle(void) {
    NSBundle *bundle = [NSBundle mainBundle];
    NSString *bundlePath = [bundle bundlePath];
    if (!bundlePath) {
        return NO;
    }
    if ([bundlePath hasSuffix:@".app"]) {
        return YES;
    }
    if ([bundlePath rangeOfString:@".app/"].location != NSNotFound) {
        return YES;
    }
    return NO;
}

#ifndef WATERBALL_HELPER_MAIN

static NSTask *g_helperTask = nil;
static NSFileHandle *g_helperStdin = nil;
static NSFileHandle *g_helperStdout = nil;

static dispatch_queue_t get_helper_queue(void) {
    static dispatch_queue_t q = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        q = dispatch_queue_create("com.waterball.bbs.notif_helper_queue", DISPATCH_QUEUE_SERIAL);
    });
    return q;
}

static BOOL ensure_dev_helper_running_locked(NSString **errOut) {
    if (g_helperTask && [g_helperTask isRunning] && g_helperStdin && g_helperStdout) {
        return YES;
    }
    g_helperTask = nil;
    g_helperStdin = nil;
    g_helperStdout = nil;

#ifdef WATERBALL_DEV_HELPER_PATH
    NSString *helperPath = [NSString stringWithUTF8String:WATERBALL_DEV_HELPER_PATH];
#else
    NSString *helperPath = nil;
#endif
    if (!helperPath || ![[NSFileManager defaultManager] isExecutableFileAtPath:helperPath]) {
        if (errOut) {
            *errOut = @"找不到內建 Waterball.app 推播代理執行檔";
        }
        return NO;
    }

    NSPipe *inPipe = [NSPipe pipe];
    NSPipe *outPipe = [NSPipe pipe];
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:helperPath];
    task.arguments = @[@"--helper-daemon"];
    task.standardInput = inPipe;
    task.standardOutput = outPipe;

    NSError *launchErr = nil;
    if (![task launchAndReturnError:&launchErr]) {
        if (errOut) {
            *errOut = [NSString stringWithFormat:@"無法啟動內建 Waterball.app 推播代理: %@",
                       launchErr ? [launchErr localizedDescription] : @"未知錯誤"];
        }
        return NO;
    }

    [[inPipe fileHandleForReading] closeFile];
    [[outPipe fileHandleForWriting] closeFile];

    g_helperTask = task;
    g_helperStdin = [inPipe fileHandleForWriting];
    g_helperStdout = [outPipe fileHandleForReading];
    return YES;
}

static bool send_via_dev_helper(
    const char *title,
    const char *body,
    const char *subtitle,
    const char *url,
    bool sound,
    char *err_buf,
    int err_buf_len
) {
    __block bool result = false;
    __block NSString *errString = nil;

    dispatch_sync(get_helper_queue(), ^{
        @autoreleasepool {
            NSString *launchErr = nil;
            if (!ensure_dev_helper_running_locked(&launchErr)) {
                errString = launchErr ?: @"無法啟動推播代理";
                return;
            }

            NSMutableDictionary *payload = [NSMutableDictionary dictionary];
            payload[@"title"] = title ? ([NSString stringWithUTF8String:title] ?: @"") : @"";
            payload[@"body"] = body ? ([NSString stringWithUTF8String:body] ?: @"") : @"";
            if (subtitle && strlen(subtitle) > 0) {
                NSString *subStr = [NSString stringWithUTF8String:subtitle];
                if (subStr) payload[@"subtitle"] = subStr;
            }
            if (url && strlen(url) > 0) {
                NSString *urlStr = [NSString stringWithUTF8String:url];
                if (urlStr) payload[@"url"] = urlStr;
            }
            payload[@"sound"] = @(sound);

            NSError *jsonErr = nil;
            NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&jsonErr];
            if (!jsonData || jsonErr) {
                errString = @"序列化通知內容失敗";
                return;
            }

            NSMutableData *lineData = [NSMutableData dataWithData:jsonData];
            [lineData appendBytes:"\n" length:1];

            @try {
                [g_helperStdin writeData:lineData];
            } @catch (NSException *e) {
                g_helperTask = nil;
                g_helperStdin = nil;
                g_helperStdout = nil;
                errString = [NSString stringWithFormat:@"寫入推播代理失敗: %@", [e reason]];
                return;
            }

            NSMutableData *respBuf = [NSMutableData data];
            while (YES) {
                NSData *chunk = nil;
                @try {
                    chunk = [g_helperStdout availableData];
                } @catch (NSException *e) {
                    break;
                }
                if (!chunk || [chunk length] == 0) {
                    break;
                }
                [respBuf appendData:chunk];
                const char *bytes = (const char *)[respBuf bytes];
                if (memchr(bytes, '\n', [respBuf length]) != NULL) {
                    break;
                }
            }

            if ([respBuf length] == 0) {
                g_helperTask = nil;
                g_helperStdin = nil;
                g_helperStdout = nil;
                errString = @"推播代理未回應";
                return;
            }

            NSDictionary *respDict = [NSJSONSerialization JSONObjectWithData:respBuf options:0 error:nil];
            if (![respDict isKindOfClass:[NSDictionary class]]) {
                errString = @"解析推播代理回應失敗";
                return;
            }

            BOOL ok = [respDict[@"ok"] boolValue];
            if (ok) {
                result = true;
            } else {
                NSString *eMsg = respDict[@"error"];
                errString = ([eMsg isKindOfClass:[NSString class]] && [eMsg length] > 0)
                    ? eMsg
                    : @"推播代理發送通知失敗";
            }
        }
    });

    if (!result && err_buf && err_buf_len > 0) {
        snprintf(err_buf, err_buf_len, "%s", errString ? [errString UTF8String] : "Failed to send notification");
    }
    return result;
}

#endif // !WATERBALL_HELPER_MAIN

void init_mac_notifications(void) {
    @autoreleasepool {
        if (!is_running_in_app_bundle()) {
#ifndef WATERBALL_HELPER_MAIN
            dispatch_async(get_helper_queue(), ^{
                @autoreleasepool {
                    ensure_dev_helper_running_locked(nil);
                }
            });
#endif
            return;
        }

        @try {
            void (^setupBlock)(void) = ^{
                UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
                [center setDelegate:[WaterballNotificationDelegate sharedDelegate]];

                [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge)
                                      completionHandler:^(BOOL granted, NSError * _Nullable error) {
                    (void)granted;
                    if (error) {
                        NSLog(@"[Waterball] UNUserNotificationCenter requestAuthorization error: %@", error);
                    }
                }];
            };

            if ([NSThread isMainThread]) {
                setupBlock();
            } else {
                dispatch_async(dispatch_get_main_queue(), setupBlock);
            }
        } @catch (NSException *e) {
            NSLog(@"[Waterball] init_mac_notifications exception: %@", e);
        }
    }
}

bool mac_send_notification(
    const char *title,
    const char *body,
    const char *subtitle,
    const char *url,
    bool sound,
    char *err_buf,
    int err_buf_len
) {
    @autoreleasepool {
        if (url && strlen(url) > 0) {
            NSString *urlStr = [NSString stringWithUTF8String:url];
            if (!urlStr || !is_valid_ptt_article_url_ns(urlStr)) {
                if (err_buf && err_buf_len > 0) {
                    snprintf(err_buf, err_buf_len, "不合法的 PTT 文章網址，僅允許 HTTPS 的 PTT 官方文章連結");
                }
                return false;
            }
        }

        if (!is_running_in_app_bundle()) {
#ifndef WATERBALL_HELPER_MAIN
            return send_via_dev_helper(title, body, subtitle, url, sound, err_buf, err_buf_len);
#else
            if (err_buf && err_buf_len > 0) {
                snprintf(err_buf, err_buf_len, "Not running inside .app bundle");
            }
            return false;
#endif
        }

        @try {
            UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
            WaterballNotificationDelegate *sharedDel = [WaterballNotificationDelegate sharedDelegate];
            if (center.delegate != sharedDel) {
                if ([NSThread isMainThread]) {
                    [center setDelegate:sharedDel];
                } else {
                    dispatch_sync(dispatch_get_main_queue(), ^{
                        [center setDelegate:sharedDel];
                    });
                }
            }

            // 1. Check permission status
            dispatch_semaphore_t semaAuth = dispatch_semaphore_create(0);
            __block UNAuthorizationStatus authStatus = UNAuthorizationStatusNotDetermined;
            [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings * _Nonnull settings) {
                authStatus = settings.authorizationStatus;
                dispatch_semaphore_signal(semaAuth);
            }];
            dispatch_semaphore_wait(semaAuth, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(5.0 * NSEC_PER_SEC)));

            if (authStatus == UNAuthorizationStatusDenied) {
                if (err_buf && err_buf_len > 0) {
                    snprintf(err_buf, err_buf_len, "系統推播權限遭拒絕，請至 macOS「系統設定」>「通知」>「Waterball」中開啟允許通知");
                }
                return false;
            }

            if (authStatus == UNAuthorizationStatusNotDetermined) {
                dispatch_semaphore_t semaReq = dispatch_semaphore_create(0);
                __block BOOL authGranted = NO;
                __block NSString *authErrStr = nil;
                [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge)
                                      completionHandler:^(BOOL granted, NSError * _Nullable error) {
                    authGranted = granted;
                    if (error) {
                        authErrStr = [error localizedDescription];
                    }
                    dispatch_semaphore_signal(semaReq);
                }];
                dispatch_semaphore_wait(semaReq, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(30.0 * NSEC_PER_SEC)));
                if (!authGranted) {
                    if (err_buf && err_buf_len > 0) {
                        if (authErrStr && [authErrStr length] > 0) {
                            snprintf(err_buf, err_buf_len, "系統推播授權失敗: %s", [authErrStr UTF8String]);
                        } else {
                            snprintf(err_buf, err_buf_len, "使用者未授權發送通知，請至 macOS「系統設定」>「通知」>「Waterball」開啟權限");
                        }
                    }
                    return false;
                }
            }

            // 2. Build notification content
            UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
            if (title) {
                content.title = [NSString stringWithUTF8String:title] ?: @"";
            }
            if (body) {
                content.body = [NSString stringWithUTF8String:body] ?: @"";
            }
            if (subtitle && strlen(subtitle) > 0) {
                NSString *subStr = [NSString stringWithUTF8String:subtitle];
                if (subStr) {
                    content.subtitle = subStr;
                }
            }
            if (sound) {
                content.sound = [UNNotificationSound defaultSound];
            }
            if (url && strlen(url) > 0) {
                NSString *urlStr = [NSString stringWithUTF8String:url];
                if (is_valid_ptt_article_url_ns(urlStr)) {
                    content.userInfo = @{ @"url": urlStr };
                }
            }
            if (@available(macOS 12.0, *)) {
                content.interruptionLevel = UNNotificationInterruptionLevelTimeSensitive;
            }

            NSString *requestIdentifier = [[NSUUID UUID] UUIDString];
            UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:requestIdentifier
                                                                                 content:content
                                                                                 trigger:nil];

            __block BOOL success = YES;
            __block NSString *errMsg = nil;
            dispatch_semaphore_t sema = dispatch_semaphore_create(0);

            [center addNotificationRequest:request withCompletionHandler:^(NSError * _Nullable error) {
                if (error) {
                    success = NO;
                    errMsg = [error localizedDescription];
                }
                dispatch_semaphore_signal(sema);
            }];

            long timeout = dispatch_semaphore_wait(sema, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(5.0 * NSEC_PER_SEC)));
            if (timeout != 0) {
                if (err_buf && err_buf_len > 0) {
                    snprintf(err_buf, err_buf_len, "發送系統通知逾時");
                }
                return false;
            }

            if (!success) {
                if (err_buf && err_buf_len > 0) {
                    snprintf(err_buf, err_buf_len, "%s", errMsg ? [errMsg UTF8String] : "Failed to add notification request");
                }
                return false;
            }

            return true;
        } @catch (NSException *e) {
            if (err_buf && err_buf_len > 0) {
                snprintf(err_buf, err_buf_len, "Notification exception: %s", [[e reason] UTF8String]);
            }
            return false;
        }
    }
}

#ifdef WATERBALL_HELPER_MAIN

@interface WaterballHelperAppDelegate : NSObject <NSApplicationDelegate>
@property (nonatomic, assign) BOOL daemonMode;
@end

@implementation WaterballHelperAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    init_mac_notifications();

    if (self.daemonMode) {
        dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
            char lineBuf[16384];
            while (fgets(lineBuf, sizeof(lineBuf), stdin) != NULL) {
                @autoreleasepool {
                    NSData *lineData = [NSData dataWithBytes:lineBuf length:strlen(lineBuf)];
                    NSDictionary *req = [NSJSONSerialization JSONObjectWithData:lineData options:0 error:nil];
                    bool ok = false;
                    char err_buf[512] = {0};

                    if ([req isKindOfClass:[NSDictionary class]]) {
                        NSString *title = [req[@"title"] isKindOfClass:[NSString class]] ? req[@"title"] : @"";
                        NSString *body = [req[@"body"] isKindOfClass:[NSString class]] ? req[@"body"] : @"";
                        NSString *subtitle = [req[@"subtitle"] isKindOfClass:[NSString class]] ? req[@"subtitle"] : nil;
                        NSString *url = [req[@"url"] isKindOfClass:[NSString class]] ? req[@"url"] : nil;
                        bool sound = req[@"sound"] ? [req[@"sound"] boolValue] : true;

                        ok = mac_send_notification(
                            [title UTF8String],
                            [body UTF8String],
                            subtitle ? [subtitle UTF8String] : NULL,
                            url ? [url UTF8String] : NULL,
                            sound,
                            err_buf,
                            sizeof(err_buf)
                        );
                    } else {
                        snprintf(err_buf, sizeof(err_buf), "Invalid helper request payload");
                    }

                    NSString *errStr = [NSString stringWithUTF8String:err_buf] ?: @"";
                    NSDictionary *resp = @{
                        @"ok": @(ok),
                        @"error": errStr
                    };
                    NSData *respData = [NSJSONSerialization dataWithJSONObject:resp options:0 error:nil];
                    if (respData) {
                        fwrite([respData bytes], 1, [respData length], stdout);
                        fwrite("\n", 1, 1, stdout);
                        fflush(stdout);
                    }
                }
            }

            dispatch_async(dispatch_get_main_queue(), ^{
                [NSApp terminate:nil];
            });
        });
    } else {
        // Launched by macOS LaunchServices upon notification click after dev process exited
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(3.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [NSApp terminate:nil];
        });
    }
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        BOOL daemonMode = NO;
        for (int i = 1; i < argc; i++) {
            if (strcmp(argv[i], "--helper-daemon") == 0) {
                daemonMode = YES;
            }
        }
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        WaterballHelperAppDelegate *del = [[WaterballHelperAppDelegate alloc] init];
        del.daemonMode = daemonMode;
        [app setDelegate:del];
        [app run];
    }
    return 0;
}

#endif // WATERBALL_HELPER_MAIN
