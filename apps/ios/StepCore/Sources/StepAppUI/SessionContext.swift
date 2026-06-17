// Signed-in session for the iOS shell (M7 #25). Holds the identity + public
// address only — never the private key (that lives in the KeyStore / in memory
// via the login wall, #27). The AuthGate shows the login wall when signed-out
// and the RootShell when signed-in. PRV-001: no coordinates here.
import Foundation
import Combine

@MainActor
public final class SessionContext: ObservableObject {
    @Published public private(set) var identity: String?
    @Published public private(set) var address: String?

    public init(identity: String? = nil, address: String? = nil) {
        self.identity = identity
        self.address = address
    }

    public var isSignedIn: Bool { address != nil }

    public func signIn(identity: String, address: String) {
        self.identity = identity
        self.address = address
    }

    public func signOut() {
        identity = nil
        address = nil
    }
}
