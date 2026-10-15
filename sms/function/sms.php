<?php

require '../vendor/autoload.php';

use AndroidSmsGateway\Client;
use AndroidSmsGateway\Encryptor;
use AndroidSmsGateway\Domain\Message;

if(isset($_POST['message']) && isset($_POST['number']) && isset($_POST['username']) && isset($_POST['password'])) {
    $login = $_POST['username'];
    $password = $_POST['password'];
    $message = $_POST['message'];
    $numberInput = $_POST['number'];
    
    // Validate the number
    $number = "+63" . $numberInput;
    
    // Check if the number starts with +639 and has correct length (Philippines mobile numbers are 10 digits after +63)
    if (!preg_match('/^\+639\d{9}$/', $number)) {
        echo 'Error: Philippine mobile number must start with 9 (format: +639XXXXXXXXX) and be 10 digits long after +63';
        die(1);
    }
    
    $client = new Client($login, $password);
    $message = new Message($message, [$number]);

    try {
        $messageState = $client->Send($message);
        echo "Message sent with ID: " . $messageState->ID() . PHP_EOL;
    } catch (Exception $e) {
        echo "Error sending message: " . $e->getMessage() . PHP_EOL;
        die(1);
    }

    try {
        $messageState = $client->GetState($messageState->ID());
        echo "Message state: " . $messageState->State() . PHP_EOL;
    } catch (Exception $e) {
        echo "Error getting message state: " . $e->getMessage() . PHP_EOL;
        die(1);
    }
} else {
    echo 'Please provide all required fields: message, number, username, and password';
}