#ifndef MAC_NOTIFICATION_H
#define MAC_NOTIFICATION_H

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

void init_mac_notifications(void);

bool mac_send_notification(
    const char *title,
    const char *body,
    const char *subtitle,
    const char *url,
    bool sound,
    char *err_buf,
    int err_buf_len
);

bool is_valid_ptt_article_url_c(const char *url);

#ifdef __cplusplus
}
#endif

#endif /* MAC_NOTIFICATION_H */
