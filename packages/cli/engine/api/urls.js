/**
 * QZone REST API URL registry.
 */
'use strict';

const REST_URLS = {
  // Overview / user info
  USER_OVERVIEW_URL: 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/main_page_cgi',
  USER_INFO_URL: 'https://user.qzone.qq.com/proxy/domain/base.qzone.qq.com/cgi-bin/user/cgi_userinfo_get_all',

  // Messages (status updates)
  MESSAGES_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6',
  MESSAGES_DETAIL_URL: 'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6',
  MESSAGES_IMAGES_URL: 'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_get_pics_v6',
  MESSAGES_VIDEOS_COMMONTS_URL: 'https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getcmtreply_v6',
  MESSAGES_VOICE_INFO_URL: 'https://user.qzone.qq.com/proxy/domain/snsapp.qzone.qq.com/cgi-bin/sound/GetVoice',

  // Blog posts
  BLOGS_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/blognew/get_abs',
  BLOGS_READ_COUNT_URL: 'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/blognew/get_count',
  BLOGS_COMMENTS_URL: 'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/blognew/get_comment_list',
  BLOGS_INFO_URL: 'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/blognew/blog_output_data',

  // Private diaries
  DIARY_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/privateblog/privateblog_get_titlelist',
  DIARY_INFO_URL: 'https://user.qzone.qq.com/proxy/domain/b.qzone.qq.com/cgi-bin/privateblog/privateblog_output_data',

  // Albums / photos
  PHOTOS_ROUTE_URL: 'https://user.qzone.qq.com/proxy/domain/route.store.qq.com/GetRoute',
  ALBUM_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/fcgi-bin/fcg_list_album_v3',
  ALBUM_PHOTOS_COMMENTS_URL: 'https://user.qzone.qq.com/proxy/domain/app.photo.qzone.qq.com/cgi-bin/app/cgi_pcomment_xml_v2',
  IMAGES_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/fcgi-bin/cgi_list_photo',
  IMAGES_INFO_URL: 'https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/fcgi-bin/cgi_floatview_photo_list_v2',

  // Friends
  FRIENDS_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/tfriend/friend_show_qqfriends.cgi',
  FRIENDS_SORT_LIST_URL: 'https://mobile.qzone.qq.com/friend/mfriend_list',
  FRIENDSHIP_INFO_URL: 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/friendship/cgi_friendship',

  // Message board / videos
  BOARD_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/m.qzone.qq.com/cgi-bin/new/get_msgb',
  VIDEO_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/video_get_data',

  // Favorites / shares
  FAVORITE_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/fav.qzone.qq.com/cgi-bin/get_fav_list',
  SHARE_LIST_URL: 'https://user.qzone.qq.com/p/h5/pc/api/sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzsharegetmylistbytype',
  SHARE_COMMENTS_URL: 'https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshareget_comment',

  // Likes / visitors
  LIKE_COUNT_URL: 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/qz_opcnt2',
  LIKE_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/users.qzone.qq.com/cgi-bin/likes/get_like_list_app',
  VISITOR_SINGLE_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_single',
  VISITOR_SIMPLE_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_simple',
  VISITOR_MORE_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_more',

  // User card
  SPECIAL_CARE_LIST_URL: 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/tfriend/specialcare_get.cgi',
  USER_CARD_URL: 'https://h5.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/cgi_personal_card',

  // Login (used by qr-login.js)
  PT_LOGIN_QRSHOW: 'https://ssl.ptlogin2.qq.com/ptqrshow',
  PT_LOGIN_QRLOGIN: 'https://ssl.ptlogin2.qq.com/ptqrlogin',
  PT_LOGIN_CHECK_SIG: '', // 由 ptqrlogin 返回的 url 直接 GET
  USER_QZONE_HOME: 'https://user.qzone.qq.com',
};

module.exports = { REST_URLS };
