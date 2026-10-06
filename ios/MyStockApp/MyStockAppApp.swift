//
//  MyStockAppApp.swift
//  MyStockApp
//
//  Created by scotty on 4/22/26.
//

import SwiftUI

@main
struct MyStockAppApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
