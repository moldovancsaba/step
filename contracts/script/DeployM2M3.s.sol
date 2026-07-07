// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {TriangleSlotNFT} from "../src/TriangleSlotNFT.sol";
import {TriangleMarketplace} from "../src/TriangleMarketplace.sol";

/// @notice Additive M2/M3 deploy: land TriangleSlotNFT + TriangleMarketplace onto
///         an ALREADY-DEPLOYED chain WITHOUT touching existing state. Grants
///         NFT_MINTER_ROLE to the gateway relayer (which mints the slot collectible
///         after each finalise, #5) and points tokenURI at the nft-indexer metadata
///         service (#6).
///
///         Env: DEPLOYER_PRIVATE_KEY (must hold DEFAULT_ADMIN_ROLE on StepAccess),
///         STEP_ACCESS, TRINITY_TOKEN, NFT_MINTER (relayer address), NFT_BASE_URI.
contract DeployM2M3 is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        StepAccess access = StepAccess(vm.envAddress("STEP_ACCESS"));
        IERC20 trinity = IERC20(vm.envAddress("TRINITY_TOKEN"));
        address minter = vm.envAddress("NFT_MINTER");
        string memory baseURI = vm.envString("NFT_BASE_URI");

        vm.startBroadcast(pk);

        TriangleSlotNFT nft = new TriangleSlotNFT(access);
        TriangleMarketplace market = new TriangleMarketplace(access, IERC721(address(nft)), trinity);

        // The gateway relayer mints slot collectibles on finalisation (#5).
        access.grantRole(keccak256("NFT_MINTER_ROLE"), minter);
        // tokenURI -> nft-indexer metadata resolver (#6); ERC721 appends the tokenId.
        nft.setBaseURI(baseURI);

        vm.stopBroadcast();

        console.log("TriangleSlotNFT", address(nft));
        console.log("TriangleMarketplace", address(market));
    }
}
