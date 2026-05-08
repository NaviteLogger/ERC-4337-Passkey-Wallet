// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title WebAuthn
 * @notice Verifies a WebAuthn assertion signature over a P-256 keypair.
 * @dev Modelled on Daimo's WebAuthn.sol. Calls the RIP-7212 precompile at 0x100;
 *      if that returns no data (i.e. unsupported on this chain) it falls back
 *      to a deployed verifier contract at `fallbackVerifier`.
 *
 *      Layout of an assertion signature passed to `verify`:
 *          bytes authenticatorData
 *          string clientDataJSON       (UTF-8, contains the b64url challenge)
 *          uint256 challengeIndex      (offset of "challenge":" inside clientDataJSON)
 *          uint256 r
 *          uint256 s
 */
library WebAuthn {
    address internal constant RIP7212 = address(0x100);

    struct Signature {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 challengeIndex;
        uint256 r;
        uint256 s;
    }

    /// @notice Returns true if `sig` is a valid WebAuthn assertion over `challenge`.
    function verify(
        bytes32 challenge,
        Signature memory sig,
        uint256 pubKeyX,
        uint256 pubKeyY,
        address fallbackVerifier
    ) internal view returns (bool) {
        if (!_challengeMatches(challenge, sig.clientDataJSON, sig.challengeIndex)) {
            return false;
        }
        // User presence (bit 0) must be set, per WebAuthn spec.
        if (sig.authenticatorData.length < 37 || (uint8(sig.authenticatorData[32]) & 0x01) == 0) {
            return false;
        }

        bytes32 messageHash = sha256(
            abi.encodePacked(sig.authenticatorData, sha256(bytes(sig.clientDataJSON)))
        );

        return _verifyP256(messageHash, sig.r, sig.s, pubKeyX, pubKeyY, fallbackVerifier);
    }

    /// @dev Tries the RIP-7212 precompile first; falls back to a deployed verifier.
    function _verifyP256(
        bytes32 messageHash,
        uint256 r,
        uint256 s,
        uint256 pubKeyX,
        uint256 pubKeyY,
        address fallbackVerifier
    ) private view returns (bool) {
        bytes memory args = abi.encode(messageHash, r, s, pubKeyX, pubKeyY);

        (bool ok, bytes memory ret) = RIP7212.staticcall(args);
        if (ok && ret.length == 32) {
            return abi.decode(ret, (uint256)) == 1;
        }

        if (fallbackVerifier == address(0)) return false;
        (ok, ret) = fallbackVerifier.staticcall(args);
        return ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }

    /// @dev Confirms the b64url-encoded challenge appears in clientDataJSON at the expected index.
    function _challengeMatches(
        bytes32 challenge,
        string memory clientDataJSON,
        uint256 idx
    ) private pure returns (bool) {
        bytes memory expected = bytes(string.concat('"challenge":"', _b64url(challenge), '"'));
        bytes memory cd = bytes(clientDataJSON);
        if (cd.length < idx + expected.length) return false;
        for (uint256 i = 0; i < expected.length; ++i) {
            if (cd[idx + i] != expected[i]) return false;
        }
        return true;
    }

    /// @dev Base64url (no padding) encoding of a 32-byte value. 43 chars output.
    function _b64url(bytes32 input) private pure returns (string memory) {
        bytes memory ALPHA =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        bytes memory out = new bytes(43);
        uint256 idx = 0;
        for (uint256 i = 0; i < 30; i += 3) {
            uint256 a = uint8(input[i]);
            uint256 b = uint8(input[i + 1]);
            uint256 c = uint8(input[i + 2]);
            uint256 packed = (a << 16) | (b << 8) | c;
            out[idx++] = ALPHA[(packed >> 18) & 0x3f];
            out[idx++] = ALPHA[(packed >> 12) & 0x3f];
            out[idx++] = ALPHA[(packed >> 6) & 0x3f];
            out[idx++] = ALPHA[packed & 0x3f];
        }
        // Final 2 bytes (input[30..31]) → 3 b64url chars (no padding).
        uint256 a2 = uint8(input[30]);
        uint256 b2 = uint8(input[31]);
        uint256 packed2 = (a2 << 8) | b2;
        out[idx++] = ALPHA[(packed2 >> 10) & 0x3f];
        out[idx++] = ALPHA[(packed2 >> 4) & 0x3f];
        out[idx++] = ALPHA[(packed2 << 2) & 0x3f];
        return string(out);
    }
}
