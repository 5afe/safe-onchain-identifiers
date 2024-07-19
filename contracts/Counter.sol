// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

contract Counter {
    uint public count;

    event Count(uint value);

    function increment() external {
        uint256 value = count + 1;

        count = value;
        emit Count(value);
    }
}
