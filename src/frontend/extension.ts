import * as vscode from "vscode";
import * as os from "os";
import * as ChildProcess from "child_process";

//=========================================================================================
let userDebugFile = "initproc"; //可以修改为其它用户程序名，如matrix
let userConf = {// Default values are suitable for rCore-Tutorial-v3 since it is most commonly used
	KERNEL_IN_BREAKPOINTS_LINE:65, 
	KERNEL_OUT_BREAKPOINTS_LINE:124, 
	GO_TO_KERNEL_LINE:30, 
	KERNEL_IN_BREAKPOINTS_FILENAME:"src/trap/mod.rs",
	KERNEL_OUT_BREAKPOINTS_FILENAME:"src/trap/mod.rs",
	GO_TO_KERNEL_FILENAME:"src/trap/mod.rs",
	executable:"",//executable with symbol. absolute path
	userSpaceDebuggeeFolder:""//absolute path
}
//========================================================================================

export function activate(context: vscode.ExtensionContext) {

	// Only allow a single Panel
	let currentPanel: vscode.WebviewPanel | undefined = undefined;

	context.subscriptions.push(
		vscode.commands.registerCommand('code-debug.eBPFPanel', () => {
			if(currentPanel){
				currentPanel.reveal(vscode.ViewColumn.Two);
			}else{
		  const panel = vscode.window.createWebviewPanel(
			'eBPFPanel',
			'eBPFPanel',
			vscode.ViewColumn.Two,
			{
			  enableScripts: true
			}
		  );
	
		  panel.webview.html = getWebviewContent();
	
		  // Handle messages from the webview
		  panel.webview.onDidReceiveMessage(
			message => {
			  switch (message.command) {
				case 'send_gdb_cli_command':
					vscode.debug.activeDebugSession?.customRequest("send_gdb_cli_command",message.text);
					break;
				case 'send_gdb_mi_command':
					vscode.debug.activeDebugSession?.customRequest("send_gdb_mi_command",message.text);
					break;
				case 'enable_side_stub':
					vscode.debug.activeDebugSession?.customRequest("send_gdb_cli_command","so "+vscode.workspace.workspaceFolders[0].uri.path+"/side-stub.py");
					break;
				case 'detect_side_stub_port':
					//😺
					ChildProcess.exec('cat '+vscode.workspace.workspaceFolders[0].uri.path+'/code_debug_qemu_output_history.txt | grep -a "char device redirected to" | tail -1', 
					(err, stdout, stderr) => {
						let re = /(?<=char device redirected to ).*(?= \()/;
						panel.webview.postMessage({ command: 'side_stub_port_is',text:re.exec(stdout)[0]});
						//console.log('stdout: ' + stdout);
						if(stderr){
							console.log('stderr in finding side_stub_port: ' + stderr)
						};
						if (err) {
							console.log('error in finding side_stub_port: ' + err);
						}
					});
					break;
				case 'exec_ebpf_daemon':
					ChildProcess.exec('active_window_id=$(xdotool search --onlyvisible --class "code" | tail -1) && xdotool windowactivate "$active_window_id" && xdotool key ctrl+grave && xdotool type ebpf_user_gdbserver && xdotool key Return');
					break;

			  }
			},
			undefined,
			context.subscriptions
		  );
		  vscode.commands.registerCommand('code-debug.registerSelectedSymbolInUserSpace', () => {
			const activeTextEditor = vscode.window.activeTextEditor;
			if (activeTextEditor) {
				const selection = activeTextEditor.selection;
				if (!selection.isEmpty) {
					let selectedText = activeTextEditor.document.getText(selection);
					let sourceFilename = activeTextEditor.document.fileName;
					//get filename only. strip file path
					let i = sourceFilename.lastIndexOf('/');
					if (i <= 0) {
						i = sourceFilename.lastIndexOf('\\');
					}
					if (i >= 0) {
						sourceFilename = sourceFilename.substring(i + 1);
					}
					let binaryFileName = sourceFilename.replace(/\.[^/.]+$/, "");

					ChildProcess.exec('nm '+vscode.workspace.workspaceFolders[0].uri.path+'/user/target/riscv64gc-unknown-none-elf/release/'+binaryFileName+' | rustfilt |grep '+selectedText, 
					(err, stdout, stderr) => {
						console.log('stdout: ' + stdout);
						panel.webview.postMessage({ command: 'symbol_table_update',text:stdout.split('\n'),program_name:binaryFileName});
						//console.log('stdout: ' + stdout);
						if(stderr){
							console.log('stderr in registering selected symbol: ' + stderr)
						};
						if (err) {
							console.log('error in registering selected symbol: ' + err);
						}
					});
					//vscode.env.clipboard.writeText(text);
					}
			}
		});
		vscode.commands.registerCommand('code-debug.registerSelectedSymbolInKernel', () => {
			const activeTextEditor = vscode.window.activeTextEditor;
			if (activeTextEditor) {
				const selection = activeTextEditor.selection;
				if (!selection.isEmpty) {
					let selectedText = activeTextEditor.document.getText(selection);
					let sourceFilename = activeTextEditor.document.fileName;
					//get filename only. strip file path
					let i = sourceFilename.lastIndexOf('/');
					if (i <= 0) {
						i = sourceFilename.lastIndexOf('\\');
					}
					if (i >= 0) {
						sourceFilename = sourceFilename.substring(i + 1);
					}
					let binaryFileName = sourceFilename.replace(/\.[^/.]+$/, "");

					ChildProcess.exec('nm '+vscode.workspace.workspaceFolders[0].uri.path+'/os/target/riscv64gc-unknown-none-elf/release/'+'os'+' | rustfilt |grep '+selectedText, 
					(err, stdout, stderr) => {
						console.log('stdout: ' + stdout);
						panel.webview.postMessage({ command: 'symbol_table_update',text:stdout.split('\n'),program_name:"kernel"});
						//console.log('stdout: ' + stdout);
						if(stderr){
							console.log('stderr in registering selected symbol: ' + stderr)
						};
						if (err) {
							console.log('error in registering selected symbol: ' + err);
						}
					});
					//vscode.env.clipboard.writeText(text);
					}
			}
		});
}})
	  );

	// vscode.debug.onDidStartDebugSession((e: vscode.DebugSession) => {
	// 	vscode.commands.executeCommand("core-debugger.startPanel"); //当启动调试会话时
	// });

	context.subscriptions.push(
		vscode.commands.registerCommand("code-debug.examineMemoryLocation", examineMemory)
	);



	const removeDebugFileCmd = vscode.commands.registerCommand("code-debug.removeDebugFile", () => {
		// 自定义请求.customRequest函数见/src/mibase.ts
		vscode.debug.activeDebugSession?.customRequest("removeDebugFile", {
			debugFilepath:
			userConf.userSpaceDebuggeeFolder+userDebugFile,
		});
		// 弹出窗口
		vscode.window.showInformationMessage("symbol file "+userDebugFile+" removed");
	});

	const setKernelInBreakpointsCmd = vscode.commands.registerCommand(
		"code-debug.setKernelInBreakpoints",
		() => {
			vscode.debug.activeDebugSession?.customRequest("setKernelInBreakpoints");
			vscode.window.showInformationMessage("Kernel In Breakpoints Set");
		}
	);
	const setKernelOutBreakpointsCmd = vscode.commands.registerCommand(
		"code-debug.setKernelOutBreakpoints",
		() => {
			vscode.debug.activeDebugSession?.customRequest("setKernelOutBreakpoints");
			vscode.window.showInformationMessage("Kernel Out Breakpoints Set");
		}
	);

	const removeAllCliBreakpointsCmd = vscode.commands.registerCommand(
		"code-debug.removeAllCliBreakpoints",
		() => {
			removeAllCliBreakpoints();
			vscode.window.showInformationMessage("All breakpoints including hidden ones are removed.");
		}
	);

	const goToKernelCmd = vscode.commands.registerCommand(
		"code-debug.goToKernel",
		() => {
			vscode.debug.activeDebugSession?.customRequest("goToKernel");
			vscode.window.showInformationMessage("go to kernel");
		}
	);

	const disableCurrentSpaceBreakpointsCmd = vscode.commands.registerCommand(
		"code-debug.disableCurrentSpaceBreakpoints",
		() => {
			vscode.window.showInformationMessage("disableCurrentSpaceBreakpoints received");
			vscode.debug.activeDebugSession?.customRequest("disableCurrentSpaceBreakpoints");
		}
	);

	// const updateAllSpacesBreakpointsInfoCmd = vscode.commands.registerCommand(
	// 	"updateAllSpacesBreakpointsInfo",
	// 	() => {
	// 		vscode.debug.activeDebugSession?.customRequest("update");
	// 	}
	// );

	context.subscriptions.push(
		removeDebugFileCmd,
		setKernelInBreakpointsCmd,
		setKernelOutBreakpointsCmd,
		removeAllCliBreakpointsCmd,
		disableCurrentSpaceBreakpointsCmd,
		//updateAllSpacesBreakpointsInfoCmd,
		goToKernelCmd,
	);

	const disposable = vscode.debug.registerDebugAdapterTrackerFactory("*", {
		createDebugAdapterTracker() {
			return {
				//监听VSCode即将发送给Debug Adapter的消息
				onWillReceiveMessage: (message) => {
					//console.log("//////////RECEIVED FROM EDITOR///////////\n "+JSON.stringify(message)+"\n//////////////////\n ");
				},
				onWillStartSession: () => {
					console.log("session started");
				},
				//监听Debug Adapter发送给VSCode的消息
				onDidSendMessage: (message) => {
					//console.log("//////////MESSAGE///////////\n "+JSON.stringify(message)+"\n//////////////////\n ");
					//TODO use switch case
					if (message.command === "setBreakpoints") {
						//如果Debug Adapter设置了一个断点
						//更新寄存器信息
						//更新断点信息
						vscode.debug.activeDebugSession?.customRequest("update");
					}
					if (message.type === "event") {
						//如果（因为断点等）停下
						//更新TreeView中的信息
						if (message.event === "stopped") {
							vscode.debug.activeDebugSession?.customRequest("update");
						} //处理自定义事件
						else if (message.event === "eventTest") {
							console.log("Extension Received eventTest");
						}
						else if (message.event === "kernelToUserBorder") {
							//到达内核态->用户态的边界
							// removeAllCliBreakpoints();
							vscode.window.showInformationMessage("will switched to " + userDebugFile + " breakpoints");
							vscode.debug.activeDebugSession?.customRequest("addDebugFile", {
								debugFilepath:
									userConf.userSpaceDebuggeeFolder +userDebugFile,
									//tag:oscomp2023 original "/user/target/riscv64gc-unknown-none-elf/release/" +userDebugFile,
			
							});
							vscode.debug.activeDebugSession?.customRequest(
								"updateCurrentSpace","src/bin/" + userDebugFile + ".rs"
								//tag:oscomp2023 original:"src/bin/" + userDebugFile + ".rs"
							);
							// TODO@werifu: show User space
							//vscode.debug.activeDebugSession?.customRequest("disableCurrentSpaceBreakpoints");
							vscode.window.showInformationMessage(
								"All breakpoints in current space removed. Symbol file " +
									userDebugFile +
									" added. Now you can set user program breakpoints.  line 11 `fn main() -> i32 {` or line 13 println!(\"aaaaa... recommemded if it's initproc.rs"
							);
							console.log("/////////////////////////kernelToUserBorder///////////////////");
						}
						//从用户态进入内核的trap处理函数
						else if (message.event === "trap_handle") {
							//vscode.window.showInformationMessage("switched to trap_handle");
							vscode.debug.activeDebugSession?.customRequest("addDebugFile", {
								debugFilepath:
									userConf.executable,
							});
							vscode.debug.activeDebugSession?.customRequest(
								"updateCurrentSpace",
								"kernel"//TODO this value used to be src/trap/mod.rs which means border breakpoints belongs to a unique space. now we changed it to 'kernel'
							);
							vscode.window.showInformationMessage("go to kernel trap_handle");
						}
						//当前在内核态
						else if (message.event === "inKernel") {
							// TODO@werifu: show Kernel space
							//removeAllCliBreakpoints();
							vscode.window.showInformationMessage("switched to kernel breakpoints");
							console.log("/////////////////////////INKERNEL///////////////////");
						}
						//当前在用户态
						else if (message.event === "inUser") {
							// TODO@werifu: show Kernel space
							//removeAllCliBreakpoints();
							vscode.window.showInformationMessage("switched to user breakpoints");
							console.log(message.body);
						}
						else if (message.event === "info") {
							console.log("//////////////INFO///////////");
							console.log(message.body);
						} else if (message.event === "showInformationMessage") {
							vscode.window.showInformationMessage(message.body);
						} else if (message.event === "printThisInConsole") {
							console.log(message.body);
						} else if (message.event === "showErrorMessage") {
							vscode.window.showErrorMessage(message.body);
						} else if (message.event === "update") {
							vscode.window.showInformationMessage("断点信息表格已经更新");
							
						} else if(message.event === "get_pname"){
							console.log("get pname:"+message.body);
							userDebugFile=message.body;
						}else if (message.event === "newProcessNameAddr") {
							console.log("newProcessNameAddr");
						
							vscode.debug.activeDebugSession?.customRequest("getStringFromAddr", message.body);



							// let quotation_regex = /"(.*?)"/;
	
							
							//let process_name = info[0].outOfBandRecord[0].content.match(quotation_regex)[0].toString();





							
						}
						else if (message.event === "output"){
							if (message.body.output.startsWith('eBPF Message: ')){//messages sent from 
								vscode.window.showInformationMessage(message.body.output);
							}
							if (message.body.output.startsWith('0x')&&message.body.output.endsWith('"\n')){//new process names
								vscode.window.showInformationMessage(message.body.output);
								let quotation_regex = /"(.*?)"/;
								let newProcessName=message.body.output;								;
								userDebugFile= newProcessName.match(quotation_regex)[0].toString().slice(1, -1);
								vscode.window.showInformationMessage("new process "+userDebugFile+" updated");
							}
							
						}
						else if (message.event === "c"){
							
						}
					}
				},
			};
		},
	});
}

function examineMemory() {
	vscode.window
		.showInputBox({
			placeHolder: "Memory Location Reference",
			validateInput: () => "",
		})
		.then((ref_addr) => {
			const x = getUriForDebugMemory(vscode.debug.activeDebugSession?.id, ref_addr, {
				fromOffset: 0x00,
				toOffset: 0x2000,
			});
			const y = vscode.Uri.parse(x);
			vscode.commands.executeCommand("vscode.openWith", y, "hexEditor.hexedit");
		});
}

// reset breakpoints in VSCode, Debug Adapter, GDB
function removeAllCliBreakpoints() {
	vscode.commands.executeCommand("workbench.debug.viewlet.action.removeAllBreakpoints"); //VSCode
	vscode.debug.activeDebugSession?.customRequest("removeAllCliBreakpoints"); //Debug Adapter, GDB
}

export const getUriForDebugMemory = (
	sessionId: string,
	memoryReference: string,
	range: { fromOffset: number; toOffset: number },
	displayName = "memory"
) => {
	return (
		"vscode-debug-memory://" +
		sessionId +
		"/" +
		encodeURIComponent(memoryReference) +
		`/${encodeURIComponent(displayName)}.bin` +
		(range ? `?range=${range.fromOffset}:${range.toOffset}` : "")
	);
};




function getWebviewContent(){
	return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>WebView</title>
		<style type="text/css">
        body,html {
			width: 100%;
			height: 100%;
		}
		html *
		{
			font-size: var(--vscode-editor-font-size) !important;
			font-family: var(--vscode-editor-font-family) !important;
		}
		button{
			color: var(--vscode-button-foreground) !important;
			background-color: var(--vscode-button-background) !important;
		}
		table{
			border: 1px solid var(--vscode-tree-tableColumnsBorder);
  			border-collapse: collapse;
			border-color: var(--vscode-tree-tableColumnsBorder);
			background-color: var(--vscode-tree-tableOddRowsBackground);
		}
		td{
			/*height: 50px; */
    		width: 100px;
			text-align: center; 
    		vertical-align: middle;
		}
        
    	</style>
	</head>
	<script>
		const vscode = acquireVsCodeApi();
		function enable_side_stub(){
			vscode.postMessage({
								command: "enable_side_stub",
							});
		}

		function detect_side_stub_port(){
			vscode.postMessage({
								command: "detect_side_stub_port",
							});
		}

		function connect(){
			let pty = document.getElementById("port").value;
			vscode.postMessage({
								command: "send_gdb_mi_command",
								text: 'side-stub target remote '+pty,
							});
		}

		function register_kprobe_or_uprobe(){
			if (document.getElementById("program_name").value==="kernel"){
				vscode.postMessage({
								command: "send_gdb_mi_command",
								text: 'side-stub tracepoint-then-get-registers '+document.getElementById("address").value,
							});
			}else{
				vscode.postMessage({
								command: "send_gdb_mi_command",
								text: 'side-stub tracepoint_user_program_then_get_registers '+document.getElementById("program_name").value +" "+ document.getElementById("address").value,
							});
			}
			
		}

		function generate_symbol_table(symbol_table){
			for(i=0;i<symbol_table.length;i++){
				if (symbol_table[i].trim().length === 0 ){//line only contains whitespaces
					continue;
				}
				let result = symbol_table[i].split(' ');
				let addr_long = result[0];
				let addr = '0x'+addr_long.substring(addr_long.length - 8);

				//A character which depicts the symbol type. 
				//If the character is in lower case then the symbol is local but if the character is in upper case then the symbol is external
				let symbol_type = result[1];
				let name = symbol_table[i].split('::').slice(-1)[0];

				let item = document.createElement('tr');
				
				let addrElem = document.createElement('td');
				addrElem.innerText=addr;

				let symbolTypeElem = document.createElement('td');
				symbolTypeElem.innerText=symbol_type;

				let nameElem = document.createElement('td');
				nameElem.innerText=name;

				let buttonElem = document.createElement('td');
				buttonElem.innerHTML = '<button>Select</button>';
				buttonElem.addEventListener('click',fillRegisterText);
				buttonElem.func_name = name;
				buttonElem.addr = addr;

				item.appendChild(addrElem);
				item.appendChild(symbolTypeElem);
				item.appendChild(nameElem);
				item.appendChild(buttonElem);
				document.getElementById('symbol_table').innerHTML='<tr><th>Address</th><th>Symbol Type</th><th>Name</th><th>Select</th></tr>';
				document.getElementById('symbol_table').appendChild(item);
			}
		}

		function fillRegisterText(evt){

			document.getElementById('address').value = evt.currentTarget.addr;
			
		}
		function exec_ebpf_daemon(){
			vscode.postMessage({
								command: "exec_ebpf_daemon",
							});
		}
		window.addEventListener('message', event => {

			const message = event.data; // The JSON data our extension sent

			switch (message.command) {
				case 'side_stub_port_is':
					document.getElementById("port").value=message.text;
					break;
				case 'symbol_table_update':
					document.getElementById('program_name').value = message.program_name;
					document.getElementById('address').value = '';
					generate_symbol_table(message.text);
					break;
			}
		});

	</script>
	<body>
		
		<div id="connection" >
				
			<p style="margin-left: 20px;margin-top: 35px;">Port:<input id="port" style="margin-left: 10px;"><br>
				<button id="enable_side_stub_button" onclick="enable_side_stub()" style="margin-left: 50px;">   Enable Side Stub  </button><br>
				<button id="detect_button" onclick="detect_side_stub_port()" style="margin-left: 50px;"     >Detect Side Stub Port</button><br>
				<button id="connect_button" onclick="connect()" style="margin-left: 50px;"                  >       Connect       </button></p>
		</div>



		<div id="register" >
			<p style="margin-left: 20px">Program Name:<input id="program_name" style="margin-left: 10px;"></p><br>
			<p style="margin-left: 20px">Address:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<input id="address" style="margin-left: 10px;"></p><br>
			<button onclick="exec_ebpf_daemon()" style="margin-left: 50px;"         >Exec eBPF Daemon</button>
			<button onclick="register_kprobe_or_uprobe()" style="margin-left: 50px;">    Register    </button>
		</div>
		<br><br>
		<table id="symbol_table">
		</table>


	</body>
	</html>`;
}
