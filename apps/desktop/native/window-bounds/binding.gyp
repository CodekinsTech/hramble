{
  "targets": [
    {
      "target_name": "window_bounds_native",
      "sources": [ "window_bounds.mm" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "conditions": [
        [ "OS==\"mac\"", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "OTHER_CFLAGS": [ "-ObjC++" ],
            "OTHER_LDFLAGS": [
              "-framework", "AppKit",
              "-framework", "ApplicationServices",
              "-framework", "Foundation"
            ]
          }
        } ]
      ]
    }
  ]
}
