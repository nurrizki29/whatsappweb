function whatsappPOSThandler(req,res){
  switch(req.params[1]){
    case 'send-message':
      postSendMessage(req,res);
      break;
    default:
      invalidAPIrequest()
  }
  // Send message
  async function postSendMessage(req, res){
    // console.log(req);

    const sender = req.body.sender;
    const number = phoneNumberFormatter(req.body.number);
    const message = await msgBodyChecker(req.body.message);
    // console.log(sessions)
    const indexClient = sessions.find(sess => sess.id == sender)
    const client = indexClient.client;

    // Make sure the sender is exists & ready
    if (!indexClient) {
      return res.status(422).json({
        status: false,
        message: `The sender: ${sender} is not found!`
      })
    }

    /**
     * Check if the number is already registered
     * Copied from app.js
     * 
     * Please check app.js for more validations example
     * You can add the same here!
     */
    let status_msg = "pending"
    let status_wa = await client.getState()
    console.log("STATUS",status_wa)
    if ( status_wa!=='CONNECTED') {
      res.status(200).json({
        status: status_msg,
      });
    }else{
      const isRegisteredNumber = await client.isRegisteredUser(number);

      if (!isRegisteredNumber) {
        return res.status(422).json({
          status: false,
          message: 'The number is not registered'
        });
      }
      status_msg="success"
      client.sendMessage(number, message).then(response => {
        res.status(200).json({
          status: true,
          response: response
        });
      }).catch(err => {
        res.status(500).json({
          status: false,
          response: err
        });
      });
    }
    let sql = "INSERT INTO `log_message` (`pengirim`, `penerima`,`pesan`,`status`,`created_at`, `updated_at`) VALUES ('"+indexClient.number+"','"+req.body.number+"','"+message+"','"+status_msg+"',CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);";
    db_wa.query(sql, function (err, result) {
      if (err) throw err;
      console.log("1 message recorded -END-");
    });
  };
}
module.exports = {
  whatsappPOSThandler
}