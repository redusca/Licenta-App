
    Set oWS = WScript.CreateObject("WScript.Shell")
    Set oLink = oWS.CreateShortcut("C:\Users\redis\Desktop\MegaDrvie\Games\CLAW-1.4.5.3\Assets\LEVEL10\IMAGES\FLOORSPIKES1\FRAME002.PID.lnk")
    oLink.TargetPath = "C:\Users\redis\Desktop\Games\CLAW-1.4.5.3\Assets\LEVEL10\IMAGES\FLOORSPIKES1\FRAME002.PID"
    oLink.Save
    